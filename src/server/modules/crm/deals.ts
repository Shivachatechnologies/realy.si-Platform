import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CrmDealStatus, CrmStageType } from "@/generated/prisma/enums";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import { applyStageRules } from "./automation";
import {
  actorId,
  authorize,
  blank,
  cleanTags,
  clearable,
  companyCurrency,
  contains,
  currencyInput,
  day,
  isUuid,
  moneyInput,
  optText,
  pageOf,
  param,
  pick,
  requireOwner,
  tagsInput,
  toDay,
  toMinor,
  userNames,
  uuid,
  ZERO_UUID,
} from "./common";
import { validateCustomFields } from "./custom-fields";
import { defaultPlacement, ensureDefaultPipeline } from "./pipelines";

export const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;
export const DEAL_SORTS = ["created", "amount", "close", "updated"] as const;

export const dealInput = z.object({
  name: z.string().trim().min(1).max(200),
  accountId: uuid.optional().or(blank),
  contactId: uuid.optional().or(blank),
  ownerId: uuid.optional().or(blank),
  pipelineId: uuid.optional().or(blank),
  stageId: uuid.optional().or(blank),
  /** Major units ("12000.50"). */
  amount: moneyInput.optional().or(blank),
  currency: currencyInput.optional().or(blank),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: day.optional().or(blank),
  source: optText(100),
  campaignCode: optText(100),
  description: optText(5000),
  tags: tagsInput.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export const dealPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  accountId: uuid.nullable().optional(),
  contactId: uuid.nullable().optional(),
  ownerId: uuid.nullable().optional(),
  amount: moneyInput.or(z.literal("")).nullable().optional(),
  currency: currencyInput.optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  expectedCloseDate: day.or(z.literal("")).nullable().optional(),
  source: clearable(100),
  campaignCode: clearable(100),
  description: clearable(5000),
  tags: tagsInput.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export const moveStageInput = z.object({ stageId: uuid, lostReason: z.string().trim().max(300).optional() });
export const closeDealInput = z.object({ outcome: z.enum(["won", "lost", "reopen"]), lostReason: z.string().trim().max(300).optional() });
export const dealBulkInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: z.array(uuid).min(1).max(500), ownerId: uuid.nullable() }),
  z.object({ action: z.literal("stage"), ids: z.array(uuid).min(1).max(500), stageId: uuid }),
  z.object({ action: z.literal("tag"), ids: z.array(uuid).min(1).max(500), tag: z.string().trim().min(1).max(40), remove: z.boolean().default(false) }),
  z.object({ action: z.literal("archive"), ids: z.array(uuid).min(1).max(500) }),
]);

export const statusForStage = (t: CrmStageType): CrmDealStatus => (t === "WON" ? "WON" : t === "LOST" ? "LOST" : "OPEN");
export const dealProbability = (d: { probability: number | null; status: CrmDealStatus; stage: { probability: number } }) =>
  d.status === "WON" ? 100 : d.status === "LOST" ? 0 : (d.probability ?? d.stage.probability);
export const dealWeighted = (d: { amountMinor: bigint; probability: number | null; status: CrmDealStatus; stage: { probability: number } }) =>
  (d.amountMinor * BigInt(dealProbability(d))) / 100n;

export interface DealFilters {
  q?: string;
  pipelineId?: string;
  stageId?: string;
  owner?: string;
  status?: CrmDealStatus;
  accountId?: string;
  source?: string;
  tag?: string;
  closeFrom?: string;
  closeTo?: string;
  stale?: boolean;
  sort?: (typeof DEAL_SORTS)[number];
  page?: number;
}

export function parseDealFilters(raw: Record<string, string | string[] | undefined>): DealFilters {
  const owner = param(raw, "owner");
  const d = (k: string) => {
    const v = param(raw, k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const pipelineId = param(raw, "pipeline");
  const stageId = param(raw, "stage");
  const accountId = param(raw, "account");
  return {
    q: param(raw, "q"),
    pipelineId: isUuid(pipelineId) ? pipelineId : undefined,
    stageId: isUuid(stageId) ? stageId : undefined,
    owner: owner === "me" || owner === "unassigned" || isUuid(owner) ? owner : undefined,
    status: pick(param(raw, "status"), DEAL_STATUSES),
    accountId: isUuid(accountId) ? accountId : undefined,
    source: param(raw, "source", 100),
    tag: param(raw, "tag", 40)?.toLowerCase(),
    closeFrom: d("closeFrom"),
    closeTo: d("closeTo"),
    stale: param(raw, "stale") === "1" || undefined,
    sort: pick(param(raw, "sort"), DEAL_SORTS),
    page: pageOf(raw).page,
  };
}

export function dealWhere(ctx: RequestContext, organizationId: string, companyId: string, f: DealFilters): Prisma.CrmDealWhereInput {
  const where: Prisma.CrmDealWhereInput = { organizationId, companyId, archivedAt: null };
  if (f.pipelineId) where.pipelineId = f.pipelineId;
  if (f.stageId) where.stageId = f.stageId;
  if (f.status) where.status = f.status;
  if (f.accountId) where.accountId = f.accountId;
  if (f.source) where.source = { equals: f.source, mode: "insensitive" };
  if (f.tag) where.tags = { has: f.tag };
  if (f.stale) where.staleSince = { not: null };
  if (f.closeFrom || f.closeTo) where.expectedCloseDate = { ...(f.closeFrom ? { gte: toDay(f.closeFrom)! } : {}), ...(f.closeTo ? { lte: toDay(f.closeTo)! } : {}) };
  if (f.owner === "me") where.ownerId = ctx.actor.id ?? ZERO_UUID;
  else if (f.owner === "unassigned") where.ownerId = null;
  else if (f.owner) where.ownerId = f.owner;
  if (f.q) where.OR = [{ name: contains(f.q) }, { account: { name: contains(f.q) } }, { campaignCode: contains(f.q) }, { source: contains(f.q) }];
  return where;
}

const dealInclude = {
  stage: { select: { id: true, name: true, type: true, probability: true } },
  pipeline: { select: { id: true, name: true } },
  account: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CrmDealInclude;

export async function listDeals(ctx: RequestContext, organizationId: string, companyId: string, f: DealFilters = {}, opts: { take?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  const where = dealWhere(ctx, organizationId, companyId, f);
  const orderBy: Prisma.CrmDealOrderByWithRelationInput[] =
    f.sort === "amount"
      ? [{ amountMinor: "desc" }]
      : f.sort === "close"
        ? [{ expectedCloseDate: { sort: "asc", nulls: "last" } }]
        : f.sort === "updated"
          ? [{ updatedAt: "desc" }]
          : [{ createdAt: "desc" }];
  const take = opts.take ?? 50;
  const [rows, total, sums] = await Promise.all([
    db().crmDeal.findMany({ where, orderBy, take, skip: ((f.page ?? 1) - 1) * take, include: dealInclude }),
    db().crmDeal.count({ where }),
    db().crmDeal.groupBy({ by: ["currency"], where, _sum: { amountMinor: true } }),
  ]);
  const names = await userNames(db(), rows.map((r) => r.ownerId));
  return {
    rows: rows.map((r) => ({ ...r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null, effectiveProbability: dealProbability(r), weightedMinor: dealWeighted(r) })),
    total,
    totals: sums.map((s) => ({ currency: s.currency, amountMinor: s._sum.amountMinor ?? 0n })),
    page: f.page ?? 1,
    pageSize: take,
  };
}

export async function getDeal(ctx: RequestContext, organizationId: string, companyId: string, dealId: string) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  if (!isUuid(dealId)) throw notFound("Deal");
  const d = await db().crmDeal.findFirst({
    where: { id: dealId, organizationId, companyId },
    include: {
      ...dealInclude,
      pipeline: { select: { id: true, name: true, stages: { where: { archivedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, type: true, probability: true } } } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      lead: { select: { id: true, name: true } },
      stageHistory: { orderBy: { changedAt: "desc" }, take: 50 },
    },
  });
  if (!d) throw notFound("Deal");
  const names = await userNames(db(), [d.ownerId, ...d.stageHistory.map((h) => h.changedById)]);
  const stageName = new Map(d.pipeline.stages.map((s) => [s.id, s.name]));
  const missing = d.stageHistory.flatMap((h) => [h.fromStageId, h.toStageId]).filter((id): id is string => !!id && !stageName.has(id));
  if (missing.length) for (const s of await db().crmPipelineStage.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) stageName.set(s.id, s.name);
  return {
    ...d,
    ownerName: d.ownerId ? (names.get(d.ownerId) ?? null) : null,
    effectiveProbability: dealProbability(d),
    weightedMinor: dealWeighted(d),
    daysInStage: Math.floor((Date.now() - d.stageEnteredAt.getTime()) / 86_400_000),
    stageHistory: d.stageHistory.map((h) => ({
      ...h,
      from: h.fromStageId ? (stageName.get(h.fromStageId) ?? null) : null,
      to: stageName.get(h.toStageId) ?? null,
      by: h.changedById ? (names.get(h.changedById) ?? null) : null,
    })),
  };
}

async function requireLinks(tx: Tx, organizationId: string, companyId: string, accountId?: string | null, contactId?: string | null) {
  if (accountId && !(await tx.account.findFirst({ where: { id: accountId, organizationId, companyId, archivedAt: null }, select: { id: true } }))) throw notFound("Account");
  if (contactId) {
    const c = await tx.contact.findFirst({ where: { id: contactId, organizationId, companyId, archivedAt: null }, select: { accountId: true } });
    if (!c) throw notFound("Contact");
    return c;
  }
  return null;
}

/** Create a deal inside an existing transaction (lead conversion, CSV import, AI). Emits deal.created and runs stage rules. */
export async function insertDeal(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, input: z.output<typeof dealInput>, extra: { leadId?: string } = {}) {
  const { pipeline, stage } = await defaultPlacement(tx, organizationId, companyId, input.pipelineId || null, input.stageId || null);
  const contact = await requireLinks(tx, organizationId, companyId, input.accountId || null, input.contactId || null);
  const currency = input.currency || (await companyCurrency(tx, organizationId, companyId)).baseCurrency;
  const status = statusForStage(stage.type);
  const d = await tx.crmDeal.create({
    data: {
      organizationId,
      companyId,
      name: input.name,
      accountId: input.accountId || contact?.accountId || null,
      contactId: input.contactId || null,
      leadId: extra.leadId ?? null,
      ownerId: input.ownerId || null,
      pipelineId: pipeline.id,
      stageId: stage.id,
      amountMinor: toMinor(input.amount, currency) ?? 0n,
      currency,
      probability: input.probability ?? null,
      expectedCloseDate: toDay(input.expectedCloseDate),
      status,
      closedAt: status === "OPEN" ? null : new Date(),
      source: input.source || null,
      campaignCode: input.campaignCode || null,
      description: input.description || null,
      tags: cleanTags(input.tags),
      customFields: await validateCustomFields(tx, companyId, "DEAL", input.customFields),
      createdById: actorId(ctx, organizationId),
    },
  });
  await tx.crmDealStageChange.create({ data: { organizationId, companyId, dealId: d.id, toStageId: stage.id, changedById: ctx.actor.id } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.deal.created", resourceType: "crm_deal", resourceId: d.id, newValue: { name: d.name, stage: stage.name, amountMinor: d.amountMinor } });
  await emitDomainEvent(tx, ctx, "deal.created", {
    organizationId,
    companyId,
    entityType: "crm_deal",
    entityId: d.id,
    data: { name: d.name, amountMinor: d.amountMinor, currency, stage: stage.name, pipeline: pipeline.name, ownerId: d.ownerId, accountId: d.accountId, source: d.source, leadId: d.leadId },
  });
  if (d.ownerId && d.ownerId !== ctx.actor.id) await notifyUsers(tx, organizationId, [d.ownerId], "crm.deal_assigned", { companyId, title: d.name, href: `/crm/deals/${d.id}` });
  await applyStageRules(tx, ctx, d, stage);
  return d;
}

export async function createDeal(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof dealInput>) {
  const input = dealInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    return insertDeal(tx, ctx, organizationId, companyId, input);
  });
}

async function requireDeal(tx: Tx, organizationId: string, companyId: string, id: string) {
  const d = isUuid(id) ? await tx.crmDeal.findFirst({ where: { id, organizationId, companyId, archivedAt: null }, include: { stage: true, pipeline: true } }) : null;
  if (!d) throw notFound("Deal");
  return d;
}

export async function updateDeal(ctx: RequestContext, organizationId: string, companyId: string, dealId: string, raw: z.input<typeof dealPatch>) {
  const input = dealPatch.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const before = await requireDeal(tx, organizationId, companyId, dealId);
    if (input.ownerId && input.ownerId !== before.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
    await requireLinks(tx, organizationId, companyId, input.accountId, input.contactId);
    const currency = input.currency ?? before.currency;
    const nul = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
    const d = await tx.crmDeal.update({
      where: { id: dealId },
      data: {
        name: input.name,
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.amount !== undefined ? { amountMinor: toMinor(input.amount, currency) ?? 0n } : {}),
        currency: input.currency,
        ...(input.probability !== undefined ? { probability: input.probability } : {}),
        ...(input.expectedCloseDate !== undefined ? { expectedCloseDate: toDay(input.expectedCloseDate) } : {}),
        source: nul(input.source),
        campaignCode: nul(input.campaignCode),
        description: nul(input.description),
        tags: input.tags ? cleanTags(input.tags) : undefined,
        customFields: input.customFields ? await validateCustomFields(tx, companyId, "DEAL", input.customFields, before.customFields, { partial: true }) : undefined,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "crm.deal.updated",
      resourceType: "crm_deal",
      resourceId: dealId,
      oldValue: { amountMinor: before.amountMinor, ownerId: before.ownerId, probability: before.probability },
      newValue: input,
    });
    if (input.ownerId && input.ownerId !== before.ownerId && input.ownerId !== ctx.actor.id) {
      await notifyUsers(tx, organizationId, [input.ownerId], "crm.deal_assigned", { companyId, title: d.name, href: `/crm/deals/${d.id}` });
    }
    return d;
  });
}

/** Move a deal into a stage of its pipeline (inside a transaction). WON/LOST stages close it; open stages reopen it. */
async function moveInTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, deal: Awaited<ReturnType<typeof requireDeal>>, stageId: string, lostReason?: string) {
  if (deal.stageId === stageId) return deal;
  const stage = await tx.crmPipelineStage.findFirst({ where: { id: stageId, pipelineId: deal.pipelineId, companyId, archivedAt: null } });
  if (!stage) throw invalid("Choose a stage of this deal's pipeline", { reason: "crm_stage_invalid" });
  const status = statusForStage(stage.type);
  const now = new Date();
  const d = await tx.crmDeal.update({
    where: { id: deal.id },
    data: {
      stageId,
      status,
      stageEnteredAt: now,
      staleSince: null,
      closedAt: status === "OPEN" ? null : now,
      lostReason: status === "LOST" ? lostReason || deal.lostReason || null : null,
    },
  });
  await tx.crmDealStageChange.create({ data: { organizationId, companyId, dealId: deal.id, fromStageId: deal.stageId, toStageId: stageId, changedById: ctx.actor.id } });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.deal.stage_changed", resourceType: "crm_deal", resourceId: deal.id, oldValue: { stage: deal.stage.name, status: deal.status }, newValue: { stage: stage.name, status } });
  const data = { name: d.name, amountMinor: d.amountMinor, currency: d.currency, fromStage: deal.stage.name, stage: stage.name, pipeline: deal.pipeline.name, ownerId: d.ownerId, accountId: d.accountId, status };
  await emitDomainEvent(tx, ctx, "deal.stage_changed", { organizationId, companyId, entityType: "crm_deal", entityId: d.id, data });
  if (status === "WON" && deal.status !== "WON") {
    await emitDomainEvent(tx, ctx, "deal.won", { organizationId, companyId, entityType: "crm_deal", entityId: d.id, data });
    // Winning a deal makes its account a customer.
    if (d.accountId) {
      const acc = await tx.account.findFirst({ where: { id: d.accountId, companyId }, select: { id: true, type: true, name: true, ownerId: true, source: true } });
      if (acc && acc.type === "PROSPECT") {
        await tx.account.update({ where: { id: acc.id }, data: { type: "CUSTOMER" } });
        await emitDomainEvent(tx, ctx, "customer.created", { organizationId, companyId, entityType: "account", entityId: acc.id, data: { name: acc.name, ownerId: acc.ownerId, source: acc.source, dealId: d.id } });
      }
    }
  }
  if (status === "LOST" && deal.status !== "LOST") await emitDomainEvent(tx, ctx, "deal.lost", { organizationId, companyId, entityType: "crm_deal", entityId: d.id, data: { ...data, lostReason: d.lostReason } });
  await applyStageRules(tx, ctx, d, stage);
  return d;
}

export async function moveDealStage(ctx: RequestContext, organizationId: string, companyId: string, dealId: string, raw: z.input<typeof moveStageInput>) {
  const input = moveStageInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const deal = await requireDeal(tx, organizationId, companyId, dealId);
    return moveInTx(tx, ctx, organizationId, companyId, deal, input.stageId, input.lostReason);
  });
}

/** Mark won / lost (moving to the pipeline's WON/LOST stage) or reopen into the first open stage. */
export async function closeDeal(ctx: RequestContext, organizationId: string, companyId: string, dealId: string, raw: z.input<typeof closeDealInput>) {
  const input = closeDealInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    const deal = await requireDeal(tx, organizationId, companyId, dealId);
    const type: CrmStageType = input.outcome === "won" ? "WON" : input.outcome === "lost" ? "LOST" : "OPEN";
    const target = await tx.crmPipelineStage.findFirst({ where: { pipelineId: deal.pipelineId, archivedAt: null, type }, orderBy: { position: "asc" } });
    if (!target) throw invalid("This pipeline has no stage of that type", { reason: "crm_stage_missing" });
    if (input.outcome === "lost" && !input.lostReason) throw invalid("Give a reason the deal was lost", { reason: "crm_lost_reason_required" });
    return moveInTx(tx, ctx, organizationId, companyId, deal, target.id, input.lostReason);
  });
}

export async function archiveDeal(ctx: RequestContext, organizationId: string, companyId: string, dealId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "sales.manage", tx);
    await requireDeal(tx, organizationId, companyId, dealId);
    await tx.crmDeal.update({ where: { id: dealId }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "crm.deal.archived", resourceType: "crm_deal", resourceId: dealId });
    return { ok: true };
  });
}

export async function bulkDeals(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof dealBulkInput>) {
  const input = dealBulkInput.parse(raw);
  return transaction(
    async (tx) => {
      const chain = await authorize(ctx, organizationId, companyId, "sales.manage", tx);
      const ids = (await tx.crmDeal.findMany({ where: { id: { in: [...new Set(input.ids)] }, organizationId, companyId, archivedAt: null }, select: { id: true } })).map((r) => r.id);
      if (!ids.length) return { count: 0 };
      if (input.action === "assign") {
        if (input.ownerId) await requireOwner(tx, organizationId, chain, input.ownerId);
        await tx.crmDeal.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.ownerId } });
        if (input.ownerId && input.ownerId !== ctx.actor.id) {
          await notifyUsers(tx, organizationId, [input.ownerId], "crm.bulk_assigned", { companyId, title: String(ids.length), href: `/crm/deals?owner=${input.ownerId}` });
        }
      } else if (input.action === "stage") {
        let moved = 0;
        for (const id of ids) {
          const deal = await requireDeal(tx, organizationId, companyId, id);
          // Deals of other pipelines are skipped (stages belong to one pipeline).
          if (!(await tx.crmPipelineStage.findFirst({ where: { id: input.stageId, pipelineId: deal.pipelineId, archivedAt: null }, select: { id: true } }))) continue;
          await moveInTx(tx, ctx, organizationId, companyId, deal, input.stageId);
          moved++;
        }
        return { count: moved };
      } else if (input.action === "tag") {
        const tag = input.tag.toLowerCase();
        for (const r of await tx.crmDeal.findMany({ where: { id: { in: ids } }, select: { id: true, tags: true } })) {
          await tx.crmDeal.update({ where: { id: r.id }, data: { tags: input.remove ? r.tags.filter((t) => t !== tag) : cleanTags([...r.tags, tag]) } });
        }
      } else {
        await tx.crmDeal.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date() } });
      }
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: `crm.deal.bulk_${input.action}`, resourceType: "crm_deal", resourceId: ids[0], newValue: { ...input, ids } });
      return { count: ids.length };
    },
    { timeout: 60_000 },
  );
}

/**
 * Kanban board of one pipeline: every stage with its deals (open stages: open deals; won/lost stages: deals closed in the
 * last 30 days), stage totals and weighted values.
 */
export async function pipelineBoard(ctx: RequestContext, organizationId: string, companyId: string, pipelineId?: string, f: { owner?: string; q?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  await transaction((tx) => ensureDefaultPipeline(tx, organizationId, companyId));
  const pipelines = await db().crmPipeline.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
    include: { stages: { where: { archivedAt: null }, orderBy: { position: "asc" } } },
  });
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0]!;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const where = dealWhere(ctx, organizationId, companyId, { owner: f.owner, q: f.q });
  const deals = await db().crmDeal.findMany({
    where: { ...where, pipelineId: pipeline.id, OR: [{ status: "OPEN" }, { closedAt: { gte: since } }] },
    orderBy: [{ expectedCloseDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 2000,
    include: { account: { select: { id: true, name: true } }, stage: { select: { probability: true } } },
  });
  const names = await userNames(db(), deals.map((d) => d.ownerId));
  const { baseCurrency } = await companyCurrency(db(), organizationId, companyId);
  const stages = pipeline.stages.map((s) => {
    const items = deals
      .filter((d) => d.stageId === s.id)
      .map((d) => ({
        id: d.id,
        name: d.name,
        accountName: d.account?.name ?? null,
        ownerName: d.ownerId ? (names.get(d.ownerId) ?? null) : null,
        amountMinor: d.amountMinor,
        currency: d.currency,
        probability: dealProbability(d),
        weightedMinor: dealWeighted(d),
        expectedCloseDate: d.expectedCloseDate,
        stale: !!d.staleSince,
        status: d.status,
      }));
    // Totals in the company currency (deals in other currencies are listed but not summed).
    const base = items.filter((d) => d.currency === baseCurrency);
    return { ...s, deals: items, totalMinor: base.reduce((a, d) => a + d.amountMinor, 0n), weightedMinor: base.reduce((a, d) => a + d.weightedMinor, 0n) };
  });
  return {
    currency: baseCurrency, pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })), pipeline: { id: pipeline.id, name: pipeline.name, staleDays: pipeline.staleDays }, stages };
}
