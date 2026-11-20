import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { SupportChannel, SupportPriority, SupportTicketStatus } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { randomToken } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { AppError, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { createTask } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { authorize, blank, CHANNELS, contactName, isUuid, normalizeEmail, OPEN_STATUSES, PRIORITIES, requireAgent, STATUSES, supportAgents, userNames, uuid } from "./common";
import { classifyTicket } from "./classifier";
import { ensureSettings } from "./config";
import { slaDueDates } from "./sla";

export const VIEWS = ["mine", "unassigned", "open", "pending", "solved", "breached", "all"] as const;
export type TicketView = (typeof VIEWS)[number];
export const SORTS = ["updated", "created", "priority", "due"] as const;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const requesterFields = {
  requesterId: uuid.optional().or(blank),
  requesterEmail: z.string().trim().toLowerCase().email().max(254).optional().or(blank),
  requesterName: z.string().trim().max(200).optional(),
};
export const createTicketInput = z.object({
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).optional(),
  ...requesterFields,
  accountId: uuid.optional().or(blank),
  channel: z.enum(CHANNELS).default("WEB"),
  priority: z.enum(PRIORITIES).optional().or(blank),
  categoryId: uuid.optional().or(blank),
  assigneeId: uuid.optional().or(blank),
  teamId: uuid.optional().or(blank),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
});
export const publicTicketInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(10_000),
  /** Honeypot: must stay empty. */
  website: z.string().max(0).optional(),
});
export const updateTicketInput = z.object({
  subject: z.string().trim().min(1).max(300).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  categoryId: uuid.nullable().optional(),
  assigneeId: uuid.nullable().optional(),
  teamId: uuid.nullable().optional(),
  accountId: uuid.nullable().optional(),
  requesterId: uuid.nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
});
export const messageInput = z.object({
  kind: z.enum(["PUBLIC_REPLY", "INTERNAL_NOTE"]),
  body: z.string().trim().min(1).max(20_000),
  /** Status to set with a public reply (defaults to PENDING when the ticket was new or open). */
  status: z.enum(STATUSES).optional(),
});
export const publicReplyInput = z.object({ body: z.string().trim().min(1).max(10_000) });
export const attachmentInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(120).regex(/^[\w.+-]+\/[\w.+-]+$/).default("application/octet-stream"),
  dataBase64: z.string().min(1).max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8),
  messageId: uuid.optional(),
});
export const followUpInput = z.object({ title: z.string().trim().min(1).max(300), assigneeId: uuid.nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(blank) });
export const ticketAiInput = z.object({ mode: z.enum(["suggest_reply", "summarize", "sentiment", "escalation", "resolution", "classify"]), guidance: z.string().trim().max(1000).optional() });

export interface TicketFilters {
  view: TicketView;
  q?: string;
  priority?: SupportPriority;
  status?: SupportTicketStatus;
  categoryId?: string;
  assigneeId?: string;
  channel?: SupportChannel;
  sort: (typeof SORTS)[number];
  page: number;
}

export function parseTicketFilters(raw: Record<string, string | string[] | undefined>): TicketFilters {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k])?.trim() || undefined;
  const pick = <T extends string>(list: readonly T[], v?: string) => (list as readonly string[]).includes(v ?? "") ? (v as T) : undefined;
  return {
    view: pick(VIEWS, one("view")) ?? "open",
    q: one("q")?.slice(0, 200),
    priority: pick(PRIORITIES, one("priority")),
    status: pick(STATUSES, one("status")),
    categoryId: isUuid(one("category")) ? one("category") : undefined,
    assigneeId: isUuid(one("assignee")) ? one("assignee") : undefined,
    channel: pick(CHANNELS, one("channel")),
    sort: pick(SORTS, one("sort")) ?? "updated",
    page: Math.min(Math.max(Number(one("page")) || 1, 1), 1000),
  };
}

const NO_USER = "00000000-0000-0000-0000-000000000000";

function viewWhere(view: TicketView, me: string | null): Prisma.SupportTicketWhereInput {
  const open = { status: { in: [...OPEN_STATUSES] } };
  switch (view) {
    case "mine":
      return { ...open, assigneeId: me ?? NO_USER };
    case "unassigned":
      return { ...open, assigneeId: null };
    case "open":
      return { status: { in: ["NEW", "OPEN"] } };
    case "pending":
      return { status: { in: ["PENDING", "ON_HOLD"] } };
    case "solved":
      return { status: { in: ["SOLVED", "CLOSED"] } };
    case "breached":
      return { ...open, OR: [{ firstResponseBreachedAt: { not: null } }, { resolutionBreachedAt: { not: null } }] };
    default:
      return {};
  }
}

const PAGE_SIZE = 25;
const PRIORITY_RANK: Record<SupportPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export async function listTickets(ctx: RequestContext, organizationId: string, companyId: string, f: TicketFilters) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const and: Prisma.SupportTicketWhereInput[] = [viewWhere(f.view, ctx.actor.id)];
  if (f.priority) and.push({ priority: f.priority });
  if (f.status) and.push({ status: f.status });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.assigneeId) and.push({ assigneeId: f.assigneeId });
  if (f.channel) and.push({ channel: f.channel });
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    const num = Number(f.q.replace(/^#/, ""));
    and.push({
      OR: [
        { subject: contains },
        { description: contains },
        { tags: { has: f.q.toLowerCase() } },
        { requester: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] } },
        { account: { name: contains } },
        ...(Number.isInteger(num) && num > 0 && num < 2 ** 31 ? [{ number: num }] : []),
      ],
    });
  }
  const where: Prisma.SupportTicketWhereInput = { organizationId, companyId, AND: and };
  const orderBy: Prisma.SupportTicketOrderByWithRelationInput[] =
    f.sort === "created" ? [{ createdAt: "desc" }] : f.sort === "due" ? [{ resolutionDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] : [{ updatedAt: "desc" }];
  const [total, rows] = await Promise.all([
    db().supportTicket.count({ where }),
    db().supportTicket.findMany({
      where,
      orderBy,
      skip: f.sort === "priority" ? 0 : (f.page - 1) * PAGE_SIZE,
      take: f.sort === "priority" ? 1000 : PAGE_SIZE,
      include: { requester: { select: { id: true, firstName: true, lastName: true, email: true } }, account: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
    }),
  ]);
  const sorted = f.sort === "priority" ? rows.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || +b.updatedAt - +a.updatedAt).slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE) : rows;
  const names = await userNames(db(), sorted.map((t) => t.assigneeId));
  return { data: sorted.map((t) => ({ ...t, assigneeName: t.assigneeId ? (names.get(t.assigneeId) ?? null) : null })), total, page: f.page, pageSize: PAGE_SIZE };
}

/** Counts per view for the inbox sidebar. */
export async function viewCounts(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const entries = await Promise.all(VIEWS.map(async (v) => [v, await db().supportTicket.count({ where: { organizationId, companyId, ...viewWhere(v, ctx.actor.id) } })] as const));
  return Object.fromEntries(entries) as Record<TicketView, number>;
}

/** Find the requester contact by email or create one (shared Contact row, CRM-owned; support may create requesters). */
async function resolveRequester(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, args: { requesterId?: string; email?: string; name?: string }, createdById: string) {
  if (args.requesterId) {
    const c = await tx.contact.findFirst({ where: { id: args.requesterId, organizationId, companyId }, select: { id: true, accountId: true, email: true } });
    if (!c) throw notFound("Contact");
    return c;
  }
  const emailNormalized = normalizeEmail(args.email);
  if (!emailNormalized) return null;
  const existing = await tx.contact.findFirst({ where: { organizationId, companyId, emailNormalized, archivedAt: null }, select: { id: true, accountId: true, email: true }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const [first, ...rest] = (args.name?.trim() || emailNormalized.split("@")[0]!).split(/\s+/);
  const c = await tx.contact.create({
    data: { organizationId, companyId, firstName: first!.slice(0, 100), lastName: rest.join(" ").slice(0, 100) || null, email: args.email!, emailNormalized, tags: ["support"], createdById },
    select: { id: true, accountId: true, email: true },
  });
  await emitDomainEvent(tx, ctx, "contact.created", { organizationId, companyId, entityType: "contact", entityId: c.id, data: { email: emailNormalized, source: "support" } });
  return c;
}

/** First matching active assignment rule (by position): round robin over its people, or by category. */
async function autoAssign(tx: Tx, organizationId: string, companyId: string, chain: ScopeChain, categoryId: string | null) {
  const rules = await tx.supportAssignmentRule.findMany({ where: { companyId, organizationId, active: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  for (const r of rules) {
    if (r.strategy === "BY_CATEGORY" && r.categoryId !== categoryId) continue;
    const eligible = await supportAgents(tx, organizationId, chain, r.assigneeIds);
    const ordered = r.assigneeIds.filter((a) => eligible.includes(a));
    if (!ordered.length) continue;
    const pick = ordered[r.cursor % ordered.length]!;
    await tx.supportAssignmentRule.update({ where: { id: r.id }, data: { cursor: (r.cursor + 1) % 1_000_000 } });
    return pick;
  }
  return null;
}

async function defaultPolicy(tx: Tx, companyId: string) {
  return tx.supportSlaPolicy.findFirst({ where: { companyId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { targets: true } });
}

const ticketHref = (id: string) => `/support/tickets/${id}`;
export const publicTicketUrl = (locale: string, token: string) => `${env().APP_URL.replace(/\/$/, "")}/${locale}/t/${token}`;

interface CreateArgs {
  subject: string;
  description?: string | null;
  requesterId?: string;
  requesterEmail?: string;
  requesterName?: string;
  accountId?: string;
  channel: SupportChannel;
  priority?: SupportPriority;
  categoryId?: string;
  assigneeId?: string;
  teamId?: string;
  tags: string[];
}

async function createInTx(tx: Tx, ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain, input: CreateArgs) {
  const company = await tx.company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { timezone: true, createdById: true, defaultLocale: true } });
  const settings = await ensureSettings(tx, organizationId, companyId);
  const counter = await tx.supportSettings.update({ where: { companyId }, data: { nextTicketNumber: { increment: 1 } }, select: { nextTicketNumber: true } });
  const number = counter.nextTicketNumber - 1;
  const requester = await resolveRequester(tx, ctx, organizationId, companyId, { requesterId: input.requesterId, email: input.requesterEmail, name: input.requesterName }, ctx.actor.id ?? company.createdById);
  let accountId = input.accountId ?? requester?.accountId ?? null;
  if (input.accountId && !(await tx.account.findFirst({ where: { id: input.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Account");
  if (input.teamId && !(await tx.team.findFirst({ where: { id: input.teamId, organizationId, companyId }, select: { id: true } }))) throw notFound("Team");
  const categories = await tx.supportCategory.findMany({ where: { companyId, organizationId, archivedAt: null }, select: { id: true, name: true, keywords: true, defaultPriority: true } });
  if (input.categoryId && !categories.some((c) => c.id === input.categoryId)) throw notFound("Category");
  const cls = classifyTicket(input.subject, input.description, categories);
  const categoryId = input.categoryId ?? cls.categoryId;
  const priority = input.priority ?? cls.priority;
  if (input.assigneeId) await requireAgent(tx, organizationId, chain, input.assigneeId);
  const assigneeId = input.assigneeId ?? (await autoAssign(tx, organizationId, companyId, chain, categoryId));
  const policy = await defaultPolicy(tx, companyId);
  const now = new Date();
  const due = slaDueDates(policy, priority, now, company.timezone);
  accountId = accountId ?? null;
  const ticket = await tx.supportTicket.create({
    data: {
      organizationId,
      companyId,
      number,
      subject: input.subject,
      description: input.description || null,
      requesterId: requester?.id ?? null,
      accountId,
      channel: input.channel,
      priority,
      status: assigneeId ? "OPEN" : "NEW",
      categoryId,
      tags: [...new Set([...input.tags, ...cls.tags])].slice(0, 20),
      assigneeId,
      teamId: input.teamId ?? null,
      publicToken: randomToken(24),
      slaPolicyId: policy?.id ?? null,
      ...due,
      classification: { categoryId: cls.categoryId, priority: cls.priority, sentiment: cls.sentiment, matched: cls.matched } as Prisma.InputJsonValue,
      createdById: ctx.actor.id,
    },
  });
  await emitDomainEvent(tx, ctx, "ticket.created", {
    organizationId,
    companyId,
    entityType: "ticket",
    entityId: ticket.id,
    data: { number, subject: ticket.subject, channel: ticket.channel, priority, status: ticket.status, categoryId, assigneeId, requesterId: ticket.requesterId, accountId, sentiment: cls.sentiment },
  });
  await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ticket.created", resourceType: "ticket", resourceId: ticket.id, newValue: { number, subject: ticket.subject, priority, assigneeId, channel: ticket.channel } });
  const title = `#${number} ${ticket.subject}`.slice(0, 120);
  if (assigneeId && assigneeId !== ctx.actor.id) await notifyUsers(tx, organizationId, [assigneeId], "support.assigned", { companyId, title, href: ticketHref(ticket.id) });
  if (!assigneeId) await notifyUsers(tx, organizationId, (await usersWithPermission(tx, organizationId, companyId, "support.manage")).filter((u) => u !== ctx.actor.id), "support.new_ticket", { companyId, title, href: ticketHref(ticket.id) });
  return { ticket, settings, locale: company.defaultLocale };
}

/** Optional AI triage (support_agent) for staff-created tickets; failures never block creation. */
async function maybeAiTriage(ctx: RequestContext, organizationId: string, companyId: string, ticket: { id: string; number: number; subject: string }, enabled: boolean) {
  if (!enabled || ctx.actor.type !== "USER") return;
  try {
    await createTask(ctx, organizationId, companyId, {
      profile: "support_agent",
      title: `Triage #${ticket.number}: ${ticket.subject}`.slice(0, 200),
      instructions: AI_MODES.classify.instructions(ticket.id),
      subject: { type: "ticket", id: ticket.id },
    });
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : err, ticketId: ticket.id }, "AI triage not queued");
  }
}

export async function createTicket(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createTicketInput>) {
  const input = createTicketInput.parse(raw);
  const { ticket, settings } = await transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "support.manage", tx);
    return createInTx(tx, ctx, organizationId, companyId, chain, {
      ...input,
      requesterId: input.requesterId || undefined,
      requesterEmail: input.requesterEmail || undefined,
      accountId: input.accountId || undefined,
      priority: input.priority || undefined,
      categoryId: input.categoryId || undefined,
      assigneeId: input.assigneeId || undefined,
      teamId: input.teamId || undefined,
    });
  });
  await maybeAiTriage(ctx, organizationId, companyId, ticket, settings.aiTriageEnabled);
  return ticket;
}

/** Public support form /support-form/<companyId>: creates a WEB ticket and emails the requester their ticket link. */
export async function createPublicTicket(companyId: string, raw: z.input<typeof publicTicketInput>, locale: string) {
  const input = publicTicketInput.parse(raw);
  if (!isUuid(companyId)) throw notFound("Company");
  const company = await db().company.findFirst({ where: { id: companyId, deletedAt: null, status: "ACTIVE" }, select: { id: true, organizationId: true, name: true } });
  if (!company) throw notFound("Company");
  const settings = await db().supportSettings.findUnique({ where: { companyId } });
  if (settings && !settings.supportFormEnabled) throw new AppError("not_available", "The support form is turned off", { reason: "support_form_disabled" });
  const ctx = systemContext();
  const { ticket } = await transaction(async (tx) => {
    const chain = await companyChain(tx, company.organizationId, company.id);
    return createInTx(tx, ctx, company.organizationId, company.id, chain, { subject: input.subject, description: input.description, requesterEmail: input.email, requesterName: input.name, channel: "WEB", tags: ["web-form"] });
  });
  const link = publicTicketUrl(locale, ticket.publicToken);
  const r = await sendPlainEmail({
    to: input.email,
    subject: `[#${ticket.number}] ${ticket.subject}`,
    text: `Hello ${input.name},\n\nWe received your request to ${company.name} and will get back to you soon.\n\nView your ticket or add details:\n${link}`,
    template: "support.ticket_received",
    organizationId: company.organizationId,
    locale,
  });
  await db().supportMessage.create({
    data: { companyId: company.id, ticketId: ticket.id, kind: "PUBLIC_REPLY", authorType: "SYSTEM", body: "Ticket received confirmation", emailStatus: r.status },
  });
  return { number: ticket.number, token: ticket.publicToken };
}

async function loadTicket(client: Tx | Db, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Ticket");
  const t = await client.supportTicket.findFirst({ where: { id, organizationId, companyId } });
  if (!t) throw notFound("Ticket");
  return t;
}

export async function getTicket(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const chain = await authorize(ctx, organizationId, companyId, "support.read");
  if (!isUuid(id)) throw notFound("Ticket");
  const t = await db().supportTicket.findFirst({
    where: { id, organizationId, companyId },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, accountId: true } },
      account: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      slaPolicy: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, fileName: true, size: true, contentType: true } } } },
      attachments: { where: { messageId: null }, select: { id: true, fileName: true, size: true, contentType: true, createdAt: true } },
    },
  });
  if (!t) throw notFound("Ticket");
  const followUps = await db().workTask.findMany({ where: { organizationId, companyId, sourceType: "ticket", sourceId: id }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true, assigneeId: true, dueDate: true } });
  const names = await userNames(db(), [t.assigneeId, ...t.messages.map((m) => m.authorUserId), ...followUps.map((f) => f.assigneeId)]);
  const team = t.teamId ? await db().team.findFirst({ where: { id: t.teamId, companyId }, select: { id: true, name: true } }) : null;
  const otherTickets = t.requesterId
    ? await db().supportTicket.findMany({ where: { companyId, requesterId: t.requesterId, id: { not: id } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, number: true, subject: true, status: true } })
    : [];
  const { publicToken, ...rest } = t;
  return {
    ...rest,
    publicToken,
    team,
    assigneeName: t.assigneeId ? (names.get(t.assigneeId) ?? null) : null,
    messages: t.messages.map((m) => ({ ...m, authorName: m.authorName ?? (m.authorUserId ? (names.get(m.authorUserId) ?? null) : null) })),
    followUps: followUps.map((f) => ({ ...f, assigneeName: f.assigneeId ? (names.get(f.assigneeId) ?? null) : null })),
    otherTickets,
    canManage: await can(ctx, "support.manage", chain),
  };
}

const STATUS_EVENTS = new Set(["SOLVED", "CLOSED"]);

export async function updateTicket(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateTicketInput>) {
  const input = updateTicketInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const before = await loadTicket(tx, organizationId, companyId, id);
    if (input.assigneeId) await requireAgent(tx, organizationId, chain, input.assigneeId);
    if (input.categoryId && !(await tx.supportCategory.findFirst({ where: { id: input.categoryId, organizationId, companyId }, select: { id: true } }))) throw notFound("Category");
    if (input.teamId && !(await tx.team.findFirst({ where: { id: input.teamId, organizationId, companyId }, select: { id: true } }))) throw notFound("Team");
    if (input.accountId && !(await tx.account.findFirst({ where: { id: input.accountId, organizationId, companyId }, select: { id: true } }))) throw notFound("Account");
    if (input.requesterId && !(await tx.contact.findFirst({ where: { id: input.requesterId, organizationId, companyId }, select: { id: true } }))) throw notFound("Contact");
    const now = new Date();
    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.teamId !== undefined) data.teamId = input.teamId;
    if (input.accountId !== undefined) data.accountId = input.accountId;
    if (input.requesterId !== undefined) data.requesterId = input.requesterId;
    if (input.tags !== undefined) data.tags = [...new Set(input.tags)];
    if (input.assigneeId !== undefined) {
      data.assigneeId = input.assigneeId;
      if (input.assigneeId && before.status === "NEW" && !input.status) data.status = "OPEN";
    }
    if (input.status && input.status !== before.status) {
      data.status = input.status;
      if (input.status === "SOLVED") data.solvedAt = now;
      if (input.status === "CLOSED") {
        data.closedAt = now;
        if (!before.solvedAt) data.solvedAt = now;
      }
      if (!STATUS_EVENTS.has(input.status)) {
        data.solvedAt = null;
        data.closedAt = null;
      }
    }
    if (input.priority && input.priority !== before.priority) {
      data.priority = input.priority;
      const policy = before.slaPolicyId ? await tx.supportSlaPolicy.findFirst({ where: { id: before.slaPolicyId }, include: { targets: true } }) : null;
      const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { timezone: true } });
      const due = slaDueDates(policy, input.priority, before.createdAt, company.timezone);
      if (!before.firstRespondedAt) data.firstResponseDueAt = due.firstResponseDueAt;
      if (!before.solvedAt) data.resolutionDueAt = due.resolutionDueAt;
    }
    const t = await tx.supportTicket.update({ where: { id }, data });
    const changed = Object.keys(data);
    const snapshot = { number: t.number, subject: t.subject, status: t.status, priority: t.priority, assigneeId: t.assigneeId, categoryId: t.categoryId, previousStatus: before.status, changed: changed.join(",") };
    await emitDomainEvent(tx, ctx, "ticket.updated", { organizationId, companyId, entityType: "ticket", entityId: id, data: snapshot });
    if (input.status && STATUS_EVENTS.has(input.status) && !STATUS_EVENTS.has(before.status)) {
      await emitDomainEvent(tx, ctx, "ticket.resolved", { organizationId, companyId, entityType: "ticket", entityId: id, data: { ...snapshot, solvedAt: now } });
    }
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "ticket.updated",
      resourceType: "ticket",
      resourceId: id,
      oldValue: { status: before.status, priority: before.priority, assigneeId: before.assigneeId, categoryId: before.categoryId },
      newValue: { status: t.status, priority: t.priority, assigneeId: t.assigneeId, categoryId: t.categoryId },
    });
    const title = `#${t.number} ${t.subject}`.slice(0, 120);
    if (input.assigneeId && input.assigneeId !== before.assigneeId && input.assigneeId !== ctx.actor.id) await notifyUsers(tx, organizationId, [input.assigneeId], "support.assigned", { companyId, title, href: ticketHref(id) });
    return t;
  });
}

/** Agent reply (emailed to the requester; truthful delivery status) or internal note. */
export async function addMessage(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof messageInput>) {
  const input = messageInput.parse(raw);
  const { message, ticket, recipient, locale } = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const ticket = await loadTicket(tx, organizationId, companyId, id);
    const now = new Date();
    const requester = ticket.requesterId ? await tx.contact.findFirst({ where: { id: ticket.requesterId }, select: { email: true } }) : null;
    const company = await tx.company.findFirstOrThrow({ where: { id: companyId }, select: { defaultLocale: true } });
    const isPublic = input.kind === "PUBLIC_REPLY";
    const message = await tx.supportMessage.create({
      data: { companyId, ticketId: id, kind: input.kind, authorType: "AGENT", authorUserId: ctx.actor.id, body: input.body, emailStatus: isPublic ? (requester?.email ? "QUEUED" : "NO_EMAIL") : null },
    });
    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    if (isPublic && !ticket.firstRespondedAt) data.firstRespondedAt = now;
    const nextStatus = input.status ?? (isPublic && (ticket.status === "NEW" || ticket.status === "OPEN") ? "PENDING" : undefined);
    if (nextStatus && nextStatus !== ticket.status) {
      data.status = nextStatus;
      if (nextStatus === "SOLVED") data.solvedAt = now;
      if (nextStatus === "CLOSED") data.closedAt = now;
    }
    if (!ticket.assigneeId && ctx.actor.id) data.assigneeId = ctx.actor.id;
    await tx.supportTicket.update({ where: { id }, data: { ...data, updatedAt: now } });
    if (data.status) {
      const snap = { number: ticket.number, subject: ticket.subject, status: String(data.status), previousStatus: ticket.status, priority: ticket.priority };
      await emitDomainEvent(tx, ctx, "ticket.updated", { organizationId, companyId, entityType: "ticket", entityId: id, data: snap });
      if (STATUS_EVENTS.has(String(data.status)) && !STATUS_EVENTS.has(ticket.status)) await emitDomainEvent(tx, ctx, "ticket.resolved", { organizationId, companyId, entityType: "ticket", entityId: id, data: { ...snap, solvedAt: now } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: isPublic ? "ticket.replied" : "ticket.note_added", resourceType: "ticket", resourceId: id, newValue: { messageId: message.id, status: data.status } });
    return { message, ticket, recipient: isPublic ? (requester?.email ?? null) : null, locale: company.defaultLocale };
  });
  if (!recipient) return { message, emailStatus: message.emailStatus };
  const r = await sendPlainEmail({
    to: recipient,
    subject: `Re: [#${ticket.number}] ${ticket.subject}`,
    text: `${input.body}\n\n—\nView the conversation or reply:\n${publicTicketUrl(locale, ticket.publicToken)}`,
    template: "support.reply",
    organizationId,
    userId: ctx.actor.id,
    locale,
  });
  await db().supportMessage.update({ where: { id: message.id }, data: { emailStatus: r.status } });
  return { message: { ...message, emailStatus: r.status }, emailStatus: r.status };
}

/** Upload an attachment (≤ 5 MB) to a ticket, optionally on one of its messages. */
export async function addAttachment(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string, raw: z.input<typeof attachmentInput>) {
  const input = attachmentInput.parse(raw);
  const data = Buffer.from(input.dataBase64, "base64");
  if (!data.length) throw invalid("Empty file", { reason: "support_attachment_empty" });
  if (data.length > MAX_ATTACHMENT_BYTES) throw new AppError("payload_too_large", "Attachments can be at most 5 MB", { reason: "support_attachment_too_large" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    await loadTicket(tx, organizationId, companyId, ticketId);
    if (input.messageId && !(await tx.supportMessage.findFirst({ where: { id: input.messageId, ticketId, companyId }, select: { id: true } }))) throw notFound("Message");
    const a = await tx.supportAttachment.create({
      data: { companyId, ticketId, messageId: input.messageId ?? null, fileName: input.fileName.replace(/[\\/\r\n"]/g, "_"), contentType: input.contentType, size: data.length, data: new Uint8Array(data), uploadedById: ctx.actor.id },
      select: { id: true, fileName: true, size: true, contentType: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ticket.attachment_added", resourceType: "ticket", resourceId: ticketId, newValue: { attachmentId: a.id, fileName: a.fileName, size: a.size } });
    return a;
  });
}

/** Attachment bytes for download (support.read at the ticket's company). */
export async function getAttachment(ctx: RequestContext, organizationId: string, companyId: string, attachmentId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  if (!isUuid(attachmentId)) throw notFound("Attachment");
  const a = await db().supportAttachment.findFirst({ where: { id: attachmentId, companyId, ticket: { organizationId } } });
  if (!a) throw notFound("Attachment");
  return a;
}

export async function deleteAttachment(ctx: RequestContext, organizationId: string, companyId: string, attachmentId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(attachmentId)) throw notFound("Attachment");
    const a = await tx.supportAttachment.findFirst({ where: { id: attachmentId, companyId, ticket: { organizationId } }, select: { id: true, ticketId: true, fileName: true } });
    if (!a) throw notFound("Attachment");
    await tx.supportAttachment.delete({ where: { id: attachmentId } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ticket.attachment_deleted", resourceType: "ticket", resourceId: a.ticketId, oldValue: { fileName: a.fileName } });
    return { ok: true };
  });
}

/** Follow-up WorkTask (sourceType "ticket"). */
export async function createFollowUp(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string, raw: z.input<typeof followUpInput>) {
  const input = followUpInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const t = await loadTicket(tx, organizationId, companyId, ticketId);
    if (input.assigneeId) await requireAgent(tx, organizationId, chain, input.assigneeId);
    const task = await tx.workTask.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        description: `Follow-up for ticket #${t.number}: ${t.subject}`,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
        priority: t.priority === "URGENT" ? "URGENT" : t.priority === "HIGH" ? "HIGH" : "MEDIUM",
        sourceType: "ticket",
        sourceId: t.id,
        labels: ["support"],
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    await emitDomainEvent(tx, ctx, "task.created", { organizationId, companyId, entityType: "work_task", entityId: task.id, data: { title: task.title, assigneeId: task.assigneeId, sourceType: "ticket", sourceId: t.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ticket.follow_up_created", resourceType: "ticket", resourceId: t.id, newValue: { taskId: task.id } });
    if (task.assigneeId && task.assigneeId !== ctx.actor.id) await notifyUsers(tx, organizationId, [task.assigneeId], "support.follow_up", { companyId, title: task.title.slice(0, 120), href: ticketHref(t.id) });
    return task;
  });
}

export async function setFollowUpDone(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string, taskId: string, done: boolean) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(taskId)) throw notFound("Task");
    const task = await tx.workTask.findFirst({ where: { id: taskId, organizationId, companyId, sourceType: "ticket", sourceId: ticketId } });
    if (!task) throw notFound("Task");
    const updated = await tx.workTask.update({ where: { id: taskId }, data: done ? { status: "DONE", completedAt: new Date() } : { status: "TODO", completedAt: null } });
    if (done && task.status !== "DONE") await emitDomainEvent(tx, ctx, "task.completed", { organizationId, companyId, entityType: "work_task", entityId: taskId, data: { title: task.title, sourceType: "ticket", sourceId: ticketId } });
    return updated;
  });
}

// ─── Public ticket page (/t/<token>) ──────────────────────────────────────────────────────────────────────────────

async function ticketByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Ticket");
  const t = await db().supportTicket.findUnique({ where: { publicToken: token }, include: { company: { select: { name: true, timezone: true } }, requester: { select: { firstName: true, lastName: true } } } });
  if (!t) throw notFound("Ticket");
  return t;
}

/** What the customer sees: public replies only (no internal notes, drafts or agent identities beyond first names). */
export async function getPublicTicket(token: string) {
  const t = await ticketByToken(token);
  const messages = await db().supportMessage.findMany({ where: { ticketId: t.id, companyId: t.companyId, kind: "PUBLIC_REPLY", authorType: { in: ["AGENT", "CUSTOMER"] }, isDraft: false }, orderBy: { createdAt: "asc" } });
  const names = await userNames(db(), messages.map((m) => m.authorUserId));
  return {
    number: t.number,
    subject: t.subject,
    description: t.description,
    status: t.status,
    createdAt: t.createdAt,
    companyName: t.company.name,
    timeZone: t.company.timezone,
    requesterName: t.requester ? contactName(t.requester) : null,
    messages: messages.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, fromCustomer: m.authorType === "CUSTOMER", authorName: m.authorType === "CUSTOMER" ? null : (names.get(m.authorUserId ?? "")?.split(" ")[0] ?? null) })),
  };
}

/** Customer reply by token (no login): reopens the ticket and tells the assignee. */
export async function addPublicReply(token: string, raw: z.input<typeof publicReplyInput>) {
  const input = publicReplyInput.parse(raw);
  const t = await ticketByToken(token);
  if (t.status === "CLOSED") throw new AppError("not_available", "This ticket is closed", { reason: "support_ticket_closed" });
  const ctx = systemContext();
  return transaction(async (tx) => {
    const m = await tx.supportMessage.create({
      data: { companyId: t.companyId, ticketId: t.id, kind: "PUBLIC_REPLY", authorType: "CUSTOMER", authorName: t.requester ? contactName(t.requester) : null, body: input.body },
    });
    const reopen = t.status === "PENDING" || t.status === "SOLVED" || t.status === "ON_HOLD";
    await tx.supportTicket.update({ where: { id: t.id }, data: { updatedAt: new Date(), ...(reopen ? { status: "OPEN", solvedAt: null } : {}) } });
    if (reopen) {
      await emitDomainEvent(tx, ctx, "ticket.updated", { organizationId: t.organizationId, companyId: t.companyId, entityType: "ticket", entityId: t.id, data: { number: t.number, status: "OPEN", previousStatus: t.status, customerReplied: true } });
    }
    const title = `#${t.number} ${t.subject}`.slice(0, 120);
    const recipients = t.assigneeId ? [t.assigneeId] : await usersWithPermission(tx, t.organizationId, t.companyId, "support.manage");
    await notifyUsers(tx, t.organizationId, recipients, "support.customer_reply", { companyId: t.companyId, title, href: ticketHref(t.id) });
    return { id: m.id };
  });
}

// ─── Customers ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Requesters (contacts) and accounts with their ticket counts. */
export async function listCustomers(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string; page?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const page = Math.max(opts.page ?? 1, 1);
  const contains = opts.q ? { contains: opts.q.slice(0, 100), mode: "insensitive" as const } : undefined;
  const where: Prisma.ContactWhereInput = {
    organizationId,
    companyId,
    supportTickets: { some: {} },
    ...(contains ? { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { account: { name: contains } }] } : {}),
  };
  const [total, contacts] = await Promise.all([
    db().contact.count({ where }),
    db().contact.findMany({
      where,
      orderBy: { firstName: "asc" },
      skip: (page - 1) * 25,
      take: 25,
      select: { id: true, firstName: true, lastName: true, email: true, account: { select: { id: true, name: true } }, _count: { select: { supportTickets: true } } },
    }),
  ]);
  const open = await db().supportTicket.groupBy({ by: ["requesterId"], where: { companyId, requesterId: { in: contacts.map((c) => c.id) }, status: { in: [...OPEN_STATUSES] } }, _count: { _all: true } });
  const openBy = new Map(open.map((o) => [o.requesterId, o._count._all]));
  return { data: contacts.map((c) => ({ ...c, ticketCount: c._count.supportTickets, openCount: openBy.get(c.id) ?? 0 })), total, page, pageSize: 25 };
}

/** One customer's record: the contact or account and all its tickets. */
export async function customerRecord(ctx: RequestContext, organizationId: string, companyId: string, kind: "contact" | "account", id: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  if (!isUuid(id)) throw notFound("Customer");
  const select = { id: true, number: true, subject: true, status: true, priority: true, channel: true, createdAt: true, solvedAt: true, assigneeId: true } as const;
  if (kind === "contact") {
    const c = await db().contact.findFirst({ where: { id, organizationId, companyId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true, account: { select: { id: true, name: true } } } });
    if (!c) throw notFound("Customer");
    const tickets = await db().supportTicket.findMany({ where: { companyId, requesterId: id }, orderBy: { createdAt: "desc" }, take: 200, select });
    return { kind, name: contactName(c), email: c.email, phone: c.phone, title: c.title, account: c.account, contacts: [] as { id: string; name: string; email: string | null }[], tickets: await withAssignees(tickets) };
  }
  const a = await db().account.findFirst({ where: { id, organizationId, companyId }, select: { id: true, name: true, email: true, phone: true, domain: true, contacts: { select: { id: true, firstName: true, lastName: true, email: true }, take: 50 } } });
  if (!a) throw notFound("Customer");
  const tickets = await db().supportTicket.findMany({ where: { companyId, accountId: id }, orderBy: { createdAt: "desc" }, take: 200, select });
  return { kind, name: a.name, email: a.email, phone: a.phone, title: a.domain, account: null, contacts: a.contacts.map((c) => ({ id: c.id, name: contactName(c), email: c.email })), tickets: await withAssignees(tickets) };
}

async function withAssignees<T extends { assigneeId: string | null }>(rows: T[]) {
  const names = await userNames(db(), rows.map((r) => r.assigneeId));
  return rows.map((r) => ({ ...r, assigneeName: r.assigneeId ? (names.get(r.assigneeId) ?? null) : null }));
}

/** Contacts and accounts for requester pickers. */
export async function searchRequesters(ctx: RequestContext, organizationId: string, companyId: string, q: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const contains = { contains: q.slice(0, 100), mode: "insensitive" as const };
  const [contacts, accounts] = await Promise.all([
    db().contact.findMany({ where: { organizationId, companyId, archivedAt: null, ...(q ? { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] } : {}) }, select: { id: true, firstName: true, lastName: true, email: true, accountId: true }, take: 15, orderBy: { firstName: "asc" } }),
    db().account.findMany({ where: { organizationId, companyId, archivedAt: null, ...(q ? { name: contains } : {}) }, select: { id: true, name: true }, take: 15, orderBy: { name: "asc" } }),
  ]);
  return { contacts: contacts.map((c) => ({ id: c.id, name: contactName(c), email: c.email, accountId: c.accountId })), accounts };
}

// ─── AI ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const AI_MODES: Record<z.infer<typeof ticketAiInput>["mode"], { profile: "support_agent" | "support_lead"; title: string; instructions: (id: string) => string }> = {
  suggest_reply: {
    profile: "support_agent",
    title: "Suggested reply",
    instructions: (id) =>
      `Call read_ticket with ticketId ${id}. Search the knowledge base with search_kb_articles for the customer's problem (try two or three queries). Then write a suggested public reply to the customer: friendly, specific, in the customer's language, citing the relevant help article titles when they apply. If the knowledge base has no answer, say what information is missing. Store the reply as a draft note with draft_ticket_reply (it needs a person's approval). Never call send_ticket_reply and never say it was sent.`,
  },
  summarize: {
    profile: "support_agent",
    title: "Ticket summary",
    instructions: (id) => `Call read_ticket with ticketId ${id}. Summarize the case for a colleague: the customer's problem, what has been tried, the current state, and the next step. Keep it short and factual.`,
  },
  sentiment: {
    profile: "support_agent",
    title: "Sentiment and context",
    instructions: (id) =>
      `Call read_ticket with ticketId ${id}. Analyze the customer's sentiment (negative / neutral / positive, with a one-line reason quoting the conversation), urgency, business impact, and any churn risk signals. Use read_support_queue if the customer has other tickets worth noting. End with a recommended tone for the next reply.`,
  },
  escalation: {
    profile: "support_lead",
    title: "Escalation recommendation",
    instructions: (id) =>
      `Call read_ticket with ticketId ${id} and read_support_queue for context. Recommend whether to escalate (yes / no), to whom or which priority, and why — considering SLA status, priority, sentiment and business impact. Do not change the ticket yourself.`,
  },
  resolution: {
    profile: "support_agent",
    title: "Resolution recommendation",
    instructions: (id) =>
      `Call read_ticket with ticketId ${id} and search the knowledge base with search_kb_articles. Recommend concrete resolution steps for the agent, citing help articles by title, and list what to verify with the customer before solving the ticket.`,
  },
  classify: {
    profile: "support_agent",
    title: "AI triage",
    instructions: (id) =>
      `Call read_ticket with ticketId ${id}. Classify the ticket: best category (from the categories listed), priority (LOW / NORMAL / HIGH / URGENT), sentiment and up to three tags, each with a one-line reason. Compare with the rule-based classification shown and say where you disagree. Do not change the ticket yourself.`,
  },
};

export async function ticketAi(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof ticketAiInput>) {
  const input = ticketAiInput.parse(raw);
  const t = await getTicket(ctx, organizationId, companyId, id);
  const spec = AI_MODES[input.mode];
  return createTask(ctx, organizationId, companyId, {
    profile: spec.profile,
    title: `${spec.title}: #${t.number} ${t.subject}`.slice(0, 200),
    instructions: [spec.instructions(t.id), input.guidance ? `Additional direction from the requester: ${input.guidance}` : null].filter(Boolean).join("\n\n"),
    subject: { type: "ticket", id: t.id },
  });
}

/** AI draft reply stored as an internal note (draft) — used by the draft_ticket_reply tool. */
export async function storeDraftReply(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string, body: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    await loadTicket(tx, organizationId, companyId, ticketId);
    const m = await tx.supportMessage.create({ data: { companyId, ticketId, kind: "INTERNAL_NOTE", authorType: "AI", authorName: "AI draft", body: body.slice(0, 20_000), isDraft: true } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ticket.draft_added", resourceType: "ticket", resourceId: ticketId, newValue: { messageId: m.id } });
    return m;
  });
}

/** Dismiss an AI draft note once used or rejected. */
export async function discardDraft(ctx: RequestContext, organizationId: string, companyId: string, ticketId: string, messageId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    if (!isUuid(messageId)) throw notFound("Message");
    const { count } = await tx.supportMessage.updateMany({ where: { id: messageId, ticketId, companyId, isDraft: true }, data: { isDraft: false } });
    if (!count) throw notFound("Message");
    return { ok: true };
  });
}
