import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { LeadScoreLabel, LeadStage } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { grantsAllow, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { normalizeEmail, normalizePhone, scoreLead } from "./scoring";
import { effectiveProbability, isOpenStage, weightedMinor } from "./pipeline";

export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export const LEAD_TEMPERATURES = ["HOT", "WARM", "NURTURE"] as const;
export const ACTIVITY_TYPES = ["CALL", "EMAIL", "MEETING", "NOTE"] as const;
export const FOLLOW_UP_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const uuid = z.string().uuid();
const isUuid = (v: string) => uuid.safeParse(v).success;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/);
const blankToUndefined = z.literal("").transform(() => undefined);

export const createLeadInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254).optional().or(blankToUndefined),
  phone: z.string().trim().max(40).optional(),
  account: z.string().trim().max(200).optional(),
  source: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(5000).optional(),
  /** Estimated value in major units ("4999.50"), stored in minor units of the company's base currency. */
  value: money.optional().or(blankToUndefined),
  ownerId: uuid.optional().or(blankToUndefined),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: day.optional().or(blankToUndefined),
  /** Create even if a lead with the same email or phone exists. */
  allowDuplicate: z.boolean().default(false),
});
export const updateLeadInput = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  notes: z.string().trim().max(5000).optional(),
  contacted: z.boolean().optional(),
  /** null unassigns. */
  ownerId: uuid.nullable().optional(),
  /** Major units; "" or null clears. */
  value: money.or(z.literal("")).nullable().optional(),
  /** null falls back to the stage default. */
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: day.or(z.literal("")).nullable().optional(),
});
export const followUpInput = z.object({
  dueAt: z.string().datetime({ offset: true }).or(day),
  note: z.string().trim().min(1).max(1000),
  priority: z.enum(FOLLOW_UP_PRIORITIES).default("MEDIUM"),
});
export const mergeInput = z.object({ secondaryId: uuid });
export const activityInput = z.object({
  type: z.enum(ACTIVITY_TYPES),
  summary: z.string().trim().min(1).max(5000),
  /** When it happened; defaults to now. */
  occurredAt: z.string().datetime({ offset: true }).or(day).optional(),
});
export const bulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stage"), ids: z.array(uuid).min(1).max(200), stage: z.enum(LEAD_STAGES) }),
  z.object({ action: z.literal("assign"), ids: z.array(uuid).min(1).max(200), ownerId: uuid.nullable() }),
  z.object({ action: z.literal("archive"), ids: z.array(uuid).min(1).max(200) }),
]);

/** Search and filters for the lead list. Unknown or empty values are ignored rather than rejected (they come from the URL). */
export interface LeadFilters {
  q?: string;
  /** "me", "unassigned" or a user id. */
  owner?: string;
  stage?: LeadStage;
  temperature?: LeadScoreLabel;
}

export function parseLeadFilters(raw: Record<string, string | string[] | undefined>): LeadFilters {
  const one = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const q = one("q")?.slice(0, 200);
  const owner = one("owner");
  const stage = one("stage");
  const temperature = one("temperature");
  return {
    q,
    owner: owner === "me" || owner === "unassigned" || (owner && isUuid(owner)) ? owner : undefined,
    stage: (LEAD_STAGES as readonly string[]).includes(stage ?? "") ? (stage as LeadStage) : undefined,
    temperature: (LEAD_TEMPERATURES as readonly string[]).includes(temperature ?? "") ? (temperature as LeadScoreLabel) : undefined,
  };
}

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "sales.read" | "sales.manage", tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  return chain;
}

const toMinor = (value?: string | null) => (value ? BigInt(Math.round(Number(value) * 100)) : null);
const toDay = (value?: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);
const toInstant = (value: string) => {
  const d = new Date(value.length === 10 ? `${value}T09:00:00Z` : value);
  if (Number.isNaN(d.getTime())) throw invalid("Invalid date");
  return d;
};

/** Users who can own leads at this company: active members holding sales.read there. */
async function eligibleOwnerIds(client: Tx | Db, organizationId: string, chain: ScopeChain, candidates?: string[]) {
  const members = await client.membership.findMany({
    where: { organizationId, status: "ACTIVE", ...(candidates ? { userId: { in: candidates } } : {}), user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  const ok: string[] = [];
  for (const m of members) if (grantsAllow(await loadGrants(client, "USER", m.userId), "sales.read", chain)) ok.push(m.userId);
  return ok;
}

async function requireOwner(tx: Tx, organizationId: string, chain: ScopeChain, ownerId: string) {
  const [ok] = await eligibleOwnerIds(tx, organizationId, chain, [ownerId]);
  if (!ok) throw invalid("This person can't own leads in this company", { reason: "lead_owner_ineligible" });
}

/** People a lead can be assigned to (id + name), for owner pickers and filters. */
export async function listOwners(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId, "sales.read");
  const ids = await eligibleOwnerIds(db(), organizationId, chain);
  return db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Active leads sharing the email or phone of the given values (same company). */
async function duplicatesOf(tx: Tx | Db, companyId: string, emailNormalized: string | null, phoneNormalized: string | null, excludeId?: string) {
  if (!emailNormalized && !phoneNormalized) return [];
  return tx.lead.findMany({
    where: {
      companyId,
      archivedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [...(emailNormalized ? [{ emailNormalized }] : []), ...(phoneNormalized ? [{ phoneNormalized }] : [])],
    },
    select: { id: true, name: true, email: true, phone: true },
    take: 5,
  });
}

function filterWhere(ctx: RequestContext, f: LeadFilters): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (f.stage) where.stage = f.stage;
  if (f.temperature) where.scoreLabel = f.temperature;
  if (f.owner === "me") where.ownerId = ctx.actor.id ?? "00000000-0000-0000-0000-000000000000";
  else if (f.owner === "unassigned") where.ownerId = null;
  else if (f.owner) where.ownerId = f.owner;
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    where.OR = [{ name: contains }, { email: contains }, { account: contains }, { phone: contains }, { owner: { name: contains } }];
  }
  return where;
}

export async function listLeads(ctx: RequestContext, organizationId: string, companyId: string, filters: LeadFilters = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return db().lead.findMany({
    where: { organizationId, companyId, archivedAt: null, ...filterWhere(ctx, filters) },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      owner: { select: { id: true, name: true } },
      followUps: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1 },
    },
  });
}

export async function getLead(ctx: RequestContext, organizationId: string, companyId: string, leadId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(leadId)) throw notFound("Lead");
  const lead = await db().lead.findFirst({
    where: { id: leadId, organizationId, companyId },
    include: {
      owner: { select: { id: true, name: true } },
      followUps: { orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }] },
      activities: { orderBy: { occurredAt: "desc" }, take: 200 },
      agentTasks: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, title: true, status: true, createdAt: true } },
    },
  });
  if (!lead) throw notFound("Lead");
  const duplicates = lead.archivedAt ? [] : await duplicatesOf(db(), companyId, lead.emailNormalized, lead.phoneNormalized, lead.id);
  const authorIds = [...new Set(lead.activities.map((a) => a.createdById))];
  const authors = authorIds.length ? await db().user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const authorName = new Map(authors.map((u) => [u.id, u.name]));
  return {
    ...lead,
    activities: lead.activities.map((a) => ({ ...a, author: authorName.get(a.createdById) ?? null })),
    duplicates,
    weightedMinor: weightedMinor(lead),
    effectiveProbability: effectiveProbability(lead),
  };
}

/** Create a lead, scored; refuses a likely duplicate (same email or phone) unless `allowDuplicate` is set. */
export async function createLead(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createLeadInput>) {
  const input = createLeadInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
    const emailNormalized = normalizeEmail(input.email);
    const phoneNormalized = normalizePhone(input.phone);
    if (!input.allowDuplicate) {
      const dupes = await duplicatesOf(tx, companyId, emailNormalized, phoneNormalized);
      if (dupes.length) throw conflict("A lead with this email or phone already exists", { reason: "lead_duplicate", leadIds: dupes.map((d) => d.id) });
    }
    const valueMinor = toMinor(input.value);
    const { score, label } = scoreLead({ ...input, valueMinor, stage: "NEW" });
    const lead = await tx.lead.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        email: input.email ?? null,
        emailNormalized,
        phone: input.phone || null,
        phoneNormalized,
        account: input.account || null,
        source: input.source || null,
        notes: input.notes || null,
        valueMinor,
        currency: company.baseCurrency,
        probability: input.probability ?? null,
        expectedCloseDate: toDay(input.expectedCloseDate),
        ownerId: input.ownerId ?? null,
        score,
        scoreLabel: label,
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "lead.created",
      resourceType: "lead",
      resourceId: lead.id,
      newValue: { name: lead.name, stage: lead.stage, score, ownerId: lead.ownerId },
    });
    return lead;
  });
}

/** Update stage, notes, owner or deal fields, or record contact; the score is recomputed. */
export async function updateLead(ctx: RequestContext, organizationId: string, companyId: string, leadId: string, raw: z.input<typeof updateLeadInput>) {
  const input = updateLeadInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(leadId)) throw notFound("Lead");
    const before = await tx.lead.findFirst({ where: { id: leadId, organizationId, companyId, archivedAt: null } });
    if (!before) throw notFound("Lead");
    if (input.ownerId && input.ownerId !== before.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    const stage = input.stage ?? before.stage;
    const notes = input.notes ?? before.notes;
    const valueMinor = input.value === undefined ? before.valueMinor : toMinor(input.value);
    const { score, label } = scoreLead({ ...before, notes, stage, valueMinor });
    const lead = await tx.lead.update({
      where: { id: leadId },
      data: {
        stage,
        notes,
        valueMinor,
        score,
        scoreLabel: label,
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.probability !== undefined ? { probability: input.probability } : {}),
        ...(input.expectedCloseDate !== undefined ? { expectedCloseDate: toDay(input.expectedCloseDate) } : {}),
        ...(input.contacted ? { lastContactedAt: new Date() } : {}),
      },
    });
    const action =
      input.stage && input.stage !== before.stage ? "lead.stage_changed" : input.ownerId !== undefined && input.ownerId !== before.ownerId ? "lead.assigned" : "lead.updated";
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action,
      resourceType: "lead",
      resourceId: leadId,
      oldValue: { stage: before.stage, score: before.score, ownerId: before.ownerId, probability: before.probability },
      newValue: { stage, score, ownerId: lead.ownerId, probability: lead.probability },
    });
    return lead;
  });
}

/** Change stage, assign an owner or archive many leads at once. Leads not found in this company are skipped. */
export async function bulkUpdateLeads(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof bulkInput>) {
  const input = bulkInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const leads = await tx.lead.findMany({ where: { id: { in: [...new Set(input.ids)] }, organizationId, companyId, archivedAt: null } });
    const ids = leads.map((l) => l.id);
    if (!ids.length) return { count: 0 };
    if (input.action === "stage") {
      for (const l of leads) {
        if (l.stage === input.stage) continue;
        const { score, label } = scoreLead({ ...l, stage: input.stage });
        await tx.lead.update({ where: { id: l.id }, data: { stage: input.stage, score, scoreLabel: label } });
      }
    } else if (input.action === "assign") {
      if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
      await tx.lead.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.ownerId } });
    } else {
      await tx.lead.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date() } });
    }
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: `lead.bulk_${input.action}`,
      resourceType: "lead",
      resourceId: ids[0],
      newValue: { ids, ...(input.action === "stage" ? { stage: input.stage } : {}), ...(input.action === "assign" ? { ownerId: input.ownerId } : {}) },
    });
    return { count: ids.length };
  });
}

async function requireActiveLead(tx: Tx, organizationId: string, companyId: string, leadId: string) {
  if (!isUuid(leadId) || !(await tx.lead.findFirst({ where: { id: leadId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Lead");
}

/** Log a call, email, meeting or note on the lead's timeline. Interactions in the past update "last contacted". */
export async function addActivity(ctx: RequestContext, organizationId: string, companyId: string, leadId: string, raw: z.input<typeof activityInput>, opts: { tx?: Tx } = {}) {
  const input = activityInput.parse(raw);
  const run = async (tx: Tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requireActiveLead(tx, organizationId, companyId, leadId);
    const occurredAt = input.occurredAt ? toInstant(input.occurredAt) : new Date();
    const a = await tx.leadActivity.create({
      data: { organizationId, companyId, leadId, type: input.type, summary: input.summary, occurredAt, createdById: ctx.actor.id ?? organizationId },
    });
    if (input.type !== "NOTE" && occurredAt <= new Date()) {
      await tx.lead.updateMany({ where: { id: leadId, OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: occurredAt } }] }, data: { lastContactedAt: occurredAt } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.activity_logged", resourceType: "lead", resourceId: leadId, newValue: { type: a.type, occurredAt } });
    return a;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

export async function addFollowUp(ctx: RequestContext, organizationId: string, companyId: string, leadId: string, raw: z.input<typeof followUpInput>) {
  const input = followUpInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requireActiveLead(tx, organizationId, companyId, leadId);
    const dueAt = toInstant(input.dueAt);
    const f = await tx.leadFollowUp.create({
      data: { organizationId, companyId, leadId, dueAt, note: input.note, priority: input.priority, createdById: ctx.actor.id ?? organizationId },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.follow_up_added", resourceType: "lead", resourceId: leadId, newValue: { dueAt, note: input.note, priority: input.priority } });
    return f;
  });
}

export async function completeFollowUp(ctx: RequestContext, organizationId: string, companyId: string, followUpId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(followUpId)) throw notFound("Follow-up");
    const { count } = await tx.leadFollowUp.updateMany({ where: { id: followUpId, organizationId, companyId, completedAt: null }, data: { completedAt: new Date() } });
    if (!count) throw notFound("Follow-up");
    const f = await tx.leadFollowUp.findUniqueOrThrow({ where: { id: followUpId } });
    await tx.lead.update({ where: { id: f.leadId }, data: { lastContactedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.follow_up_completed", resourceType: "lead", resourceId: f.leadId });
    return { ok: true };
  });
}

/** Open follow-ups due by the end of today (UTC), oldest first; optionally only for leads owned by `ownerId`. */
export async function dueFollowUps(ctx: RequestContext, organizationId: string, companyId: string, opts: { ownerId?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return db().leadFollowUp.findMany({
    where: { organizationId, companyId, completedAt: null, dueAt: { lte: end }, lead: { archivedAt: null, ...(opts.ownerId ? { ownerId: opts.ownerId } : {}) } },
    orderBy: [{ dueAt: "asc" }],
    take: 50,
    include: { lead: { select: { id: true, name: true, account: true, owner: { select: { id: true, name: true } } } } },
  });
}

/**
 * Merge `secondaryId` into `primaryId` (same company), adapted from Shivacha OS: blank fields on the primary are filled
 * from the secondary, follow-ups and activities move over, the higher score wins, and the secondary is archived with mergedIntoId.
 */
export async function mergeLeads(ctx: RequestContext, organizationId: string, companyId: string, primaryId: string, raw: z.input<typeof mergeInput>) {
  const { secondaryId } = mergeInput.parse(raw);
  if (primaryId === secondaryId) throw invalid("Choose two different leads");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (!isUuid(primaryId)) throw notFound("Lead");
    const [a, b] = await Promise.all([
      tx.lead.findFirst({ where: { id: primaryId, organizationId, companyId, archivedAt: null } }),
      tx.lead.findFirst({ where: { id: secondaryId, organizationId, companyId, archivedAt: null } }),
    ]);
    if (!a || !b) throw notFound("Lead");
    const fill = {
      email: a.email ?? b.email,
      emailNormalized: a.emailNormalized ?? b.emailNormalized,
      phone: a.phone ?? b.phone,
      phoneNormalized: a.phoneNormalized ?? b.phoneNormalized,
      account: a.account ?? b.account,
      source: a.source ?? b.source,
      valueMinor: a.valueMinor ?? b.valueMinor,
      ownerId: a.ownerId ?? b.ownerId,
      probability: a.probability ?? b.probability,
      expectedCloseDate: a.expectedCloseDate ?? b.expectedCloseDate,
      notes: a.notes && b.notes && a.notes !== b.notes ? `${a.notes}\n\n— merged from ${b.name} —\n${b.notes}`.slice(0, 5000) : (a.notes ?? b.notes),
      lastContactedAt: [a.lastContactedAt, b.lastContactedAt].filter(Boolean).sort((x, y) => y!.getTime() - x!.getTime())[0] ?? null,
    };
    const { score, label } = scoreLead({ ...fill, stage: a.stage });
    await tx.lead.update({ where: { id: a.id }, data: { ...fill, score: Math.max(score, b.score), scoreLabel: Math.max(score, b.score) === score ? label : b.scoreLabel } });
    await tx.leadFollowUp.updateMany({ where: { leadId: b.id }, data: { leadId: a.id } });
    await tx.leadActivity.updateMany({ where: { leadId: b.id }, data: { leadId: a.id } });
    await tx.lead.update({ where: { id: b.id }, data: { archivedAt: new Date(), mergedIntoId: a.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "lead.merged", resourceType: "lead", resourceId: a.id, oldValue: { mergedFrom: b.id, name: b.name } });
    return { id: a.id };
  });
}

// ───────────── Dashboard ─────────────

const FUNNEL: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON"];
const DAY_MS = 86_400_000;

/** CRM dashboard from live data: new leads, stage funnel, overdue follow-ups, owner performance and pipeline value. */
export async function crmDashboard(ctx: RequestContext, organizationId: string, companyId: string, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const [leads, overdue] = await Promise.all([
    db().lead.findMany({
      where: { organizationId, companyId, archivedAt: null },
      select: { id: true, stage: true, valueMinor: true, probability: true, ownerId: true, createdAt: true, scoreLabel: true },
      take: 20_000,
    }),
    db().leadFollowUp.findMany({
      where: { organizationId, companyId, completedAt: null, dueAt: { lt: now }, lead: { archivedAt: null } },
      orderBy: { dueAt: "asc" },
      take: 500,
      include: { lead: { select: { id: true, name: true, ownerId: true } } },
    }),
  ]);

  const newSince = (days: number) => leads.filter((l) => l.createdAt.getTime() >= now.getTime() - days * DAY_MS).length;
  const byStage = LEAD_STAGES.map((stage) => {
    const items = leads.filter((l) => l.stage === stage);
    return { stage, count: items.length, valueMinor: items.reduce((s, l) => s + (l.valueMinor ?? 0n), 0n) };
  });
  // Funnel from current stages: a lead at a later stage has passed the earlier ones. Lost leads are excluded.
  const funnelIndex = (s: LeadStage) => FUNNEL.indexOf(s);
  const reached = FUNNEL.map((stage, i) => ({ stage, count: leads.filter((l) => l.stage !== "LOST" && funnelIndex(l.stage) >= i).length }));
  const funnel = reached.map((r, i) => ({ ...r, conversion: i === 0 || !reached[i - 1].count ? null : r.count / reached[i - 1].count }));
  const won = leads.filter((l) => l.stage === "WON").length;
  const lost = leads.filter((l) => l.stage === "LOST").length;

  const open = leads.filter((l) => isOpenStage(l.stage));
  const pipeline = {
    openCount: open.length,
    openValueMinor: open.reduce((s, l) => s + (l.valueMinor ?? 0n), 0n),
    weightedMinor: open.reduce((s, l) => s + weightedMinor(l), 0n),
    wonValueMinor: leads.filter((l) => l.stage === "WON").reduce((s, l) => s + (l.valueMinor ?? 0n), 0n),
  };

  const ownerKeys = [...new Set(leads.map((l) => l.ownerId))];
  const users = await db().user.findMany({ where: { id: { in: ownerKeys.filter((k): k is string => !!k) } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const owners = ownerKeys
    .map((ownerId) => {
      const mine = leads.filter((l) => l.ownerId === ownerId);
      const mineOpen = mine.filter((l) => isOpenStage(l.stage));
      const w = mine.filter((l) => l.stage === "WON").length;
      const lo = mine.filter((l) => l.stage === "LOST").length;
      return {
        ownerId,
        name: ownerId ? (nameOf.get(ownerId) ?? null) : null,
        open: mineOpen.length,
        won: w,
        lost: lo,
        winRate: w + lo ? w / (w + lo) : null,
        wonValueMinor: mine.filter((l) => l.stage === "WON").reduce((s, l) => s + (l.valueMinor ?? 0n), 0n),
        weightedMinor: mineOpen.reduce((s, l) => s + weightedMinor(l), 0n),
        overdue: overdue.filter((f) => f.lead.ownerId === ownerId).length,
      };
    })
    .sort((a, b) => (b.weightedMinor > a.weightedMinor ? 1 : b.weightedMinor < a.weightedMinor ? -1 : b.open - a.open));

  return {
    total: leads.length,
    newLeads: { last7: newSince(7), last30: newSince(30) },
    byStage,
    funnel,
    winRate: won + lost ? won / (won + lost) : null,
    temperature: LEAD_TEMPERATURES.map((t) => ({ label: t, count: open.filter((l) => l.scoreLabel === t).length })),
    pipeline,
    overdue: { count: overdue.length, items: overdue.slice(0, 10) },
    owners,
  };
}
