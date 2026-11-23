import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, forbidden, invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { sendPlainEmail } from "@/server/modules/email/service";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { daysAgo, isUuid, reasonSchema, requireAnyPlatform } from "./access";
import { notifyAdmins } from "./notifications";

/**
 * Platform support center (stream F): customers' tickets TO REALY (`platform_support_tickets`). This is not the
 * `support` module, which is each company's own helpdesk for its customers.
 *
 * Customer side (user app, `/help/contact-realy` + `/api/v1/platform-support/**`): a signed-in person opens tickets,
 * follows them, replies and marks them solved. They never see internal notes, assignees or SLA internals.
 * Admin side (`/support`): queue, assign/reassign, priority, escalate, reply (emailed to the requester), internal
 * notes, solve/close/reopen, SLA, links to incidents, organizations and users, and the customer health view.
 * Every admin change is audited (category ADMIN, the ticket's organization).
 */

export const TICKET_CATEGORIES = ["billing", "bug", "account", "ai", "integration", "other"] as const;
export const TICKET_STATUSES = ["NEW", "OPEN", "PENDING_CUSTOMER", "ON_HOLD", "SOLVED", "CLOSED"] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
type Priority = (typeof TICKET_PRIORITIES)[number];
type Status = (typeof TICKET_STATUSES)[number];

/** First-response SLA per priority (hours). Stored as `slaDueAt` at creation and on priority changes. */
export const SLA_HOURS: Record<Priority, number> = { URGENT: 4, HIGH: 8, NORMAL: 24, LOW: 72 };
const slaDue = (from: Date, p: Priority) => new Date(from.getTime() + SLA_HOURS[p] * 3_600_000);
const OPEN_STATUSES: Status[] = ["NEW", "OPEN", "PENDING_CUSTOMER", "ON_HOLD"];

const READ = ["platform.support.read", "platform.support.manage"];
const MANAGE = "platform.support.manage";
const body = z.string().trim().min(1).max(10_000);

// ───────────────────────────── Customer side ─────────────────────────────

const requireUser = (ctx: RequestContext) => {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Sign in to contact support");
  return ctx.actor.id;
};

export const createTicketInput = z.object({
  subject: z.string().trim().min(3).max(200),
  body,
  category: z.enum(TICKET_CATEGORIES).default("other"),
  /** Customers choose LOW / NORMAL / HIGH; URGENT is set by staff. */
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  organizationId: z.string().uuid().nullish(),
});

/** Open a ticket as the signed-in person (optionally for one of their organizations). */
export async function createPlatformTicket(ctx: RequestContext, raw: z.input<typeof createTicketInput>) {
  const userId = requireUser(ctx);
  const input = createTicketInput.parse(raw);
  const user = await db().user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user) throw forbidden("Sign in to contact support");
  if (input.organizationId) {
    const m = await db().membership.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId } }, select: { status: true } });
    if (!m || m.status !== "ACTIVE") throw forbidden("You are not a member of this organization");
  }
  // Abuse guard: at most 10 open tickets per person.
  const open = await db().platformSupportTicket.count({ where: { requesterId: userId, status: { in: OPEN_STATUSES } } });
  if (open >= 10) throw conflict("You already have 10 open tickets. Reply to one of them instead.", { reason: "too_many_open_tickets" });
  const now = new Date();
  const ticket = await transaction(async (tx) => {
    const t = await tx.platformSupportTicket.create({
      data: { organizationId: input.organizationId ?? null, requesterId: userId, requesterEmail: user.email, subject: input.subject, category: input.category, priority: input.priority, slaDueAt: slaDue(now, input.priority), lastCustomerAt: now, channel: "in_app" },
    });
    await tx.platformSupportMessage.create({ data: { ticketId: t.id, authorType: "customer", authorId: userId, body: input.body } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: t.organizationId, action: "platform_support.ticket_created", resourceType: "platform_support_ticket", resourceId: t.id, newValue: { number: t.number, category: t.category, priority: t.priority } });
    return t;
  });
  await notifyAdmins(ctx, { permission: "platform.support.read", type: "support.ticket_created", severity: input.priority === "HIGH" ? "WARNING" : "INFO", title: `#${ticket.number} ${ticket.subject}`, href: `/support/${ticket.id}`, dedupeKey: `support:${ticket.id}` }).catch(() => undefined);
  return { id: ticket.id, number: ticket.number };
}

/** Customer-visible shape: no assignee, escalation, tags or SLA internals. */
const customerTicket = (t: { id: string; number: number; subject: string; category: string | null; status: string; priority: string; organizationId: string | null; createdAt: Date; updatedAt: Date; solvedAt: Date | null }) => ({
  id: t.id,
  number: t.number,
  subject: t.subject,
  category: t.category,
  status: t.status,
  priority: t.priority,
  organizationId: t.organizationId,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  solvedAt: t.solvedAt,
});

/** The signed-in person's tickets, newest first (keyset pages of 20). */
export async function listMyPlatformTickets(ctx: RequestContext, raw: { cursor?: string; status?: string } = {}) {
  const userId = requireUser(ctx);
  const cursor = raw.cursor && isUuid(raw.cursor) ? raw.cursor : undefined;
  const open = raw.status === "open" ? { status: { in: OPEN_STATUSES } } : raw.status === "closed" ? { status: { in: ["SOLVED", "CLOSED"] as Status[] } } : {};
  const rows = await db().platformSupportTicket.findMany({ where: { requesterId: userId, ...open }, orderBy: { id: "desc" }, take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  const more = rows.length > 20;
  const data = more ? rows.slice(0, 20) : rows;
  return { data: data.map(customerTicket), nextCursor: more ? data[data.length - 1]!.id : null };
}

async function ownTicket(userId: string, ticketId: string, client: Tx | ReturnType<typeof db> = db()) {
  if (!isUuid(ticketId)) throw notFound("Ticket");
  const t = await client.platformSupportTicket.findUnique({ where: { id: ticketId } });
  // Not found (never forbidden) for someone else's ticket: ids are not enumerable.
  if (!t || t.requesterId !== userId) throw notFound("Ticket");
  return t;
}

/** One of my tickets with the public conversation (internal notes excluded). */
export async function getMyPlatformTicket(ctx: RequestContext, ticketId: string) {
  const userId = requireUser(ctx);
  const t = await ownTicket(userId, ticketId);
  const messages = await db().platformSupportMessage.findMany({ where: { ticketId: t.id, internal: false }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, authorType: true, authorId: true, body: true, createdAt: true } });
  return { ticket: customerTicket(t), messages: messages.map((m) => ({ ...m, mine: m.authorType === "customer" && m.authorId === userId, authorId: undefined })) };
}

export const customerReplyInput = z.object({ body });

/** Customer reply: reopens a pending/solved ticket (CLOSED tickets are final: open a new one). */
export async function replyMyPlatformTicket(ctx: RequestContext, ticketId: string, raw: z.input<typeof customerReplyInput>) {
  const userId = requireUser(ctx);
  const input = customerReplyInput.parse(raw);
  const result = await transaction(async (tx) => {
    const t = await ownTicket(userId, ticketId, tx);
    if (t.status === "CLOSED") throw conflict("This ticket is closed. Open a new ticket instead.", { reason: "ticket_closed" });
    const now = new Date();
    await tx.platformSupportMessage.create({ data: { ticketId: t.id, authorType: "customer", authorId: userId, body: input.body } });
    const status: Status = t.status === "NEW" ? "NEW" : "OPEN";
    await tx.platformSupportTicket.update({ where: { id: t.id }, data: { status, lastCustomerAt: now, ...(t.status === "SOLVED" ? { solvedAt: null } : {}) } });
    return { t, status };
  });
  if (result.t.assigneeId) await notifyAdmins(ctx, { userId: result.t.assigneeId, type: "support.customer_replied", title: `#${result.t.number} ${result.t.subject}`, href: `/support/${result.t.id}`, dedupeKey: `support-reply:${result.t.id}` }).catch(() => undefined);
  return { status: result.status };
}

/** The customer marks their ticket solved. */
export async function solveMyPlatformTicket(ctx: RequestContext, ticketId: string) {
  const userId = requireUser(ctx);
  return transaction(async (tx) => {
    const t = await ownTicket(userId, ticketId, tx);
    if (t.status === "SOLVED" || t.status === "CLOSED") throw conflict("The ticket is already solved");
    await tx.platformSupportTicket.update({ where: { id: t.id }, data: { status: "SOLVED", solvedAt: new Date() } });
    await tx.platformSupportMessage.create({ data: { ticketId: t.id, authorType: "system", body: "Marked as solved by the customer." } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: t.organizationId, action: "platform_support.ticket_solved_by_customer", resourceType: "platform_support_ticket", resourceId: t.id, oldValue: { status: t.status } });
    return { status: "SOLVED" as const };
  });
}

/** Organizations the person may file a ticket for (their active memberships). */
export async function myTicketOrganizations(ctx: RequestContext) {
  const userId = requireUser(ctx);
  const rows = await db().membership.findMany({ where: { userId, status: "ACTIVE" }, select: { organization: { select: { id: true, name: true } } }, take: 50 });
  return rows.map((r) => r.organization);
}

// ───────────────────────────── Admin side ─────────────────────────────

const queueFilters = z.object({
  status: z.enum([...TICKET_STATUSES, "open", "all"]).default("open").catch("open"),
  priority: z.enum(TICKET_PRIORITIES).optional().catch(undefined),
  assignee: z.string().max(40).optional().catch(undefined),
  org: z.string().uuid().optional().catch(undefined),
  user: z.string().uuid().optional().catch(undefined),
  category: z.enum(TICKET_CATEGORIES).optional().catch(undefined),
  sla: z.enum(["breached", "due"]).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  cursor: z.string().uuid().optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(100).default(50).catch(50),
});
export type SupportQueueFilters = Partial<Record<keyof z.input<typeof queueFilters>, unknown>>;

const people = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db().user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true } }) : [];
  return (id: string | null | undefined) => (id ? (rows.find((u) => u.id === id) ?? null) : null);
};
const orgs = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await db().organization.findMany({ where: { id: { in: list } }, select: { id: true, name: true, status: true } }) : [];
  return (id: string | null | undefined) => (id ? (rows.find((o) => o.id === id) ?? null) : null);
};

/** The support queue: filters, keyset pages, counts by status and SLA state. */
export async function supportQueue(ctx: RequestContext, raw: SupportQueueFilters = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = queueFilters.parse(raw);
  const now = new Date();
  const num = f.q && /^#?\d{1,9}$/.test(f.q) ? Number(f.q.replace("#", "")) : null;
  const where: Prisma.PlatformSupportTicketWhereInput = {
    ...(f.status === "open" ? { status: { in: OPEN_STATUSES } } : f.status === "all" ? {} : { status: f.status }),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.assignee === "me" ? { assigneeId: ctx.actor.id } : f.assignee === "none" ? { assigneeId: null } : f.assignee && isUuid(f.assignee) ? { assigneeId: f.assignee } : {}),
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.user ? { requesterId: f.user } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.sla === "breached" ? { firstResponseAt: null, slaDueAt: { lt: now }, status: { in: OPEN_STATUSES } } : f.sla === "due" ? { firstResponseAt: null, slaDueAt: { gte: now, lt: new Date(now.getTime() + 4 * 3_600_000) }, status: { in: OPEN_STATUSES } } : {}),
    ...(f.q ? { OR: [...(num ? [{ number: num }] : []), { subject: { contains: f.q, mode: "insensitive" } }, { requesterEmail: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, byStatus, breached, unassigned] = await Promise.all([
    db().platformSupportTicket.findMany({ where, orderBy: { id: "desc" }, take: f.limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) }),
    db().platformSupportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    db().platformSupportTicket.count({ where: { firstResponseAt: null, slaDueAt: { lt: now }, status: { in: OPEN_STATUSES } } }),
    db().platformSupportTicket.count({ where: { assigneeId: null, status: { in: OPEN_STATUSES } } }),
  ]);
  const more = rows.length > f.limit;
  const data = more ? rows.slice(0, f.limit) : rows;
  const [person, org] = await Promise.all([people(data.flatMap((t) => [t.assigneeId, t.requesterId])), orgs(data.map((t) => t.organizationId))]);
  return {
    filters: f,
    counts: { byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])) as Record<string, number>, breached, unassigned },
    data: data.map((t) => ({ ...t, assignee: person(t.assigneeId), requester: person(t.requesterId), organization: org(t.organizationId), slaState: slaState(t, now) })),
    nextCursor: more ? data[data.length - 1]!.id : null,
  };
}

/**
 * Open platform tickets and those past their first-response SLA (Action Center `support.tickets`, stream A). No
 * permission check: the Action Center shows the item only to admins who may open /support.
 */
export async function supportAttention(now = new Date()) {
  const breachedWhere: Prisma.PlatformSupportTicketWhereInput = { firstResponseAt: null, slaDueAt: { lt: now }, status: { in: OPEN_STATUSES } };
  const [open, breached, oldest, samples] = await Promise.all([
    db().platformSupportTicket.count({ where: { status: { in: OPEN_STATUSES } } }),
    db().platformSupportTicket.count({ where: breachedWhere }),
    db().platformSupportTicket.findFirst({ where: { status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db().platformSupportTicket.findMany({ where: breachedWhere, orderBy: { slaDueAt: "asc" }, take: 5, select: { id: true, number: true, subject: true, priority: true, slaDueAt: true } }),
  ]);
  return { open, breached, oldestAt: oldest?.createdAt ?? null, samples };
}

/** met (first response before due), breached, due (< 4 h left), ok, or none (no SLA / closed without response). */
export function slaState(t: { slaDueAt: Date | null; firstResponseAt: Date | null; status: string }, now = new Date()) {
  if (!t.slaDueAt) return "none";
  if (t.firstResponseAt) return t.firstResponseAt <= t.slaDueAt ? "met" : "breached";
  if (!OPEN_STATUSES.includes(t.status as Status)) return "none";
  if (t.slaDueAt < now) return "breached";
  return t.slaDueAt.getTime() - now.getTime() < 4 * 3_600_000 ? "due" : "ok";
}

/** Full ticket for staff: conversation incl. internal notes, people, organization, history and other tickets. */
export async function supportTicket(ctx: RequestContext, ticketId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(ticketId)) throw notFound("Ticket");
  const t = await db().platformSupportTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw notFound("Ticket");
  const [messages, audit, related, staff] = await Promise.all([
    db().platformSupportMessage.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" }, take: 500 }),
    db().auditLog.findMany({ where: { resourceType: "platform_support_ticket", resourceId: t.id }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, actorId: true, reason: true, oldValue: true, newValue: true, createdAt: true } }),
    db().platformSupportTicket.findMany({ where: { id: { not: t.id }, OR: [...(t.organizationId ? [{ organizationId: t.organizationId }] : []), ...(t.requesterId ? [{ requesterId: t.requesterId }] : [])] }, orderBy: { id: "desc" }, take: 10, select: { id: true, number: true, subject: true, status: true, createdAt: true } }),
    supportStaff(),
  ]);
  const [person, org] = await Promise.all([people([t.assigneeId, t.requesterId, ...messages.map((m) => m.authorId), ...audit.map((a) => a.actorId)]), orgs([t.organizationId])]);
  const emails = messages.filter((m) => m.emailMessageId).map((m) => m.emailMessageId!);
  const emailRows = emails.length ? await db().emailMessage.findMany({ where: { id: { in: emails } }, select: { id: true, status: true } }) : [];
  return {
    ticket: { ...t, slaState: slaState(t) },
    requester: person(t.requesterId),
    assignee: person(t.assigneeId),
    organization: org(t.organizationId),
    messages: messages.map((m) => ({ ...m, author: person(m.authorId), emailStatus: emailRows.find((e) => e.id === m.emailMessageId)?.status ?? null })),
    audit: audit.map((a) => ({ ...a, actor: person(a.actorId) })),
    related,
    staff,
  };
}

/** Platform admins who can work tickets (assignee picker). */
export async function supportStaff() {
  const grants = await db().roleAssignment.findMany({
    where: { principalType: "USER", scopeType: "PLATFORM", role: { permissions: { some: { permission: { key: { in: ["platform.support.manage"] } } } } } },
    select: { principalId: true },
    take: 200,
  });
  const ids = [...new Set(grants.map((g) => g.principalId))];
  return ids.length ? db().user.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }) : [];
}

async function loadForUpdate(tx: Tx, ctx: RequestContext, ticketId: string) {
  await requirePermission(ctx, MANAGE, platformChain(), tx);
  if (!isUuid(ticketId)) throw notFound("Ticket");
  const t = await tx.platformSupportTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw notFound("Ticket");
  return t;
}

const audit = (tx: Tx, ctx: RequestContext, t: { id: string; organizationId: string | null }, action: string, oldValue: unknown, newValue: unknown, reason?: string | null) =>
  writeAudit(tx, ctx, { category: "ADMIN", organizationId: t.organizationId, action: `platform_support.${action}`, resourceType: "platform_support_ticket", resourceId: t.id, oldValue, newValue, reason: reason ?? null });

export const assignInput = z.object({ assigneeId: z.string().uuid().nullable(), reason: z.string().trim().max(500).optional() });

/** Assign / reassign (or unassign with null). The assignee must hold platform.support.manage. */
export async function assignTicket(ctx: RequestContext, ticketId: string, raw: z.input<typeof assignInput>) {
  const input = assignInput.parse(raw);
  const result = await transaction(async (tx) => {
    const t = await loadForUpdate(tx, ctx, ticketId);
    if (t.assigneeId === input.assigneeId) throw conflict("Already assigned to this person");
    if (input.assigneeId) {
      const allowed = await can({ requestId: ctx.requestId, actor: { type: "USER", id: input.assigneeId }, mfaVerifiedAt: new Date(), sessionId: null, ip: null, userAgent: null }, MANAGE, platformChain(), tx);
      if (!allowed) throw invalid("The assignee must be platform support staff", { reason: "assignee_not_support_staff" });
    }
    await tx.platformSupportTicket.update({ where: { id: t.id }, data: { assigneeId: input.assigneeId, ...(t.status === "NEW" && input.assigneeId ? { status: "OPEN" } : {}) } });
    await audit(tx, ctx, t, t.assigneeId ? "reassigned" : "assigned", { assigneeId: t.assigneeId }, { assigneeId: input.assigneeId }, input.reason);
    return t;
  });
  if (input.assigneeId && input.assigneeId !== ctx.actor.id) await notifyAdmins(ctx, { userId: input.assigneeId, type: "support.ticket_assigned", title: `#${result.number} ${result.subject}`, href: `/support/${result.id}` }).catch(() => undefined);
  return { assigneeId: input.assigneeId };
}

export const statusInput = z.object({ status: z.enum(TICKET_STATUSES), reason: z.string().trim().max(500).optional() });

/** Status changes: solve, close, reopen (from SOLVED/CLOSED a reason is required), hold, wait for the customer. */
export async function setTicketStatus(ctx: RequestContext, ticketId: string, raw: z.input<typeof statusInput>) {
  const input = statusInput.parse(raw);
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, ctx, ticketId);
    if (t.status === input.status) throw conflict("The ticket already has this status");
    const reopening = (t.status === "SOLVED" || t.status === "CLOSED") && OPEN_STATUSES.includes(input.status);
    if ((reopening || input.status === "CLOSED") && !reasonSchema.safeParse(input.reason).success) throw invalid("A reason is required to close or reopen a ticket", { reason: "reason_required" });
    const now = new Date();
    await tx.platformSupportTicket.update({
      where: { id: t.id },
      data: { status: input.status, ...(input.status === "SOLVED" ? { solvedAt: now } : {}), ...(input.status === "CLOSED" ? { closedAt: now, solvedAt: t.solvedAt ?? now } : {}), ...(reopening ? { solvedAt: null, closedAt: null } : {}) },
    });
    await tx.platformSupportMessage.create({ data: { ticketId: t.id, authorType: "system", authorId: ctx.actor.id, internal: true, body: `Status ${t.status} → ${input.status}${input.reason ? `: ${input.reason}` : ""}` } });
    await audit(tx, ctx, t, reopening ? "reopened" : input.status === "CLOSED" ? "closed" : input.status === "SOLVED" ? "solved" : "status_changed", { status: t.status }, { status: input.status }, input.reason);
    return { status: input.status };
  });
}

export const priorityInput = z.object({ priority: z.enum(TICKET_PRIORITIES), reason: z.string().trim().max(500).optional() });

/** Change priority; the SLA due time is recomputed from creation while no first response was sent. */
export async function setTicketPriority(ctx: RequestContext, ticketId: string, raw: z.input<typeof priorityInput>) {
  const input = priorityInput.parse(raw);
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, ctx, ticketId);
    if (t.priority === input.priority) throw conflict("The ticket already has this priority");
    const due = t.firstResponseAt ? t.slaDueAt : slaDue(t.createdAt, input.priority);
    await tx.platformSupportTicket.update({ where: { id: t.id }, data: { priority: input.priority, slaDueAt: due } });
    await audit(tx, ctx, t, "priority_changed", { priority: t.priority, slaDueAt: t.slaDueAt }, { priority: input.priority, slaDueAt: due }, input.reason);
    return { priority: input.priority, slaDueAt: due };
  });
}

export const escalateInput = z.object({ reason: reasonSchema, assigneeId: z.string().uuid().nullish() });

/** Escalate: level + 1, priority at least HIGH (URGENT from level 2), optional new assignee; notifies support staff. */
export async function escalateTicket(ctx: RequestContext, ticketId: string, raw: z.input<typeof escalateInput>) {
  const input = escalateInput.parse(raw);
  const result = await transaction(async (tx) => {
    const t = await loadForUpdate(tx, ctx, ticketId);
    if (!OPEN_STATUSES.includes(t.status)) throw conflict("Reopen the ticket before escalating it");
    const level = t.escalationLevel + 1;
    const rank = (p: Priority) => TICKET_PRIORITIES.indexOf(p);
    const target: Priority = level >= 2 ? "URGENT" : "HIGH";
    const priority = rank(t.priority) < rank(target) ? target : t.priority;
    await tx.platformSupportTicket.update({ where: { id: t.id }, data: { escalationLevel: level, priority, ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}), ...(t.firstResponseAt ? {} : { slaDueAt: slaDue(t.createdAt, priority) }) } });
    await tx.platformSupportMessage.create({ data: { ticketId: t.id, authorType: "system", authorId: ctx.actor.id, internal: true, body: `Escalated to level ${level}: ${input.reason}` } });
    await audit(tx, ctx, t, "escalated", { escalationLevel: t.escalationLevel, priority: t.priority, assigneeId: t.assigneeId }, { escalationLevel: level, priority, assigneeId: input.assigneeId ?? t.assigneeId }, input.reason);
    return { t, level, priority };
  });
  await notifyAdmins(ctx, { permission: MANAGE, type: "support.ticket_escalated", severity: result.priority === "URGENT" ? "CRITICAL" : "WARNING", title: `#${result.t.number} escalated (level ${result.level})`, href: `/support/${result.t.id}`, dedupeKey: `support-esc:${result.t.id}:${result.level}` }).catch(() => undefined);
  return { escalationLevel: result.level, priority: result.priority };
}

export const replyInput = z.object({ body, internal: z.boolean().default(false), status: z.enum(["OPEN", "PENDING_CUSTOMER", "ON_HOLD", "SOLVED"]).optional() });

/**
 * Staff reply (emailed to the requester through the platform provider; the email outcome is recorded truthfully on
 * the message) or internal note (never visible to the customer, never emailed). A public reply sets the first
 * response time and, by default, waits for the customer.
 */
export async function replyTicket(ctx: RequestContext, ticketId: string, raw: z.input<typeof replyInput>) {
  const input = replyInput.parse(raw);
  const { t, message } = await transaction(async (tx) => {
    const t = await loadForUpdate(tx, ctx, ticketId);
    if (t.status === "CLOSED" && !input.internal) throw conflict("Reopen the ticket before replying", { reason: "ticket_closed" });
    const message = await tx.platformSupportMessage.create({ data: { ticketId: t.id, authorType: "staff", authorId: ctx.actor.id, body: input.body, internal: input.internal } });
    if (!input.internal) {
      const now = new Date();
      const status = input.status ?? "PENDING_CUSTOMER";
      await tx.platformSupportTicket.update({ where: { id: t.id }, data: { status, firstResponseAt: t.firstResponseAt ?? now, ...(t.assigneeId ? {} : { assigneeId: ctx.actor.id }), ...(status === "SOLVED" ? { solvedAt: now } : {}) } });
    }
    await audit(tx, ctx, t, input.internal ? "note_added" : "replied", null, { messageId: message.id, status: input.internal ? t.status : (input.status ?? "PENDING_CUSTOMER") });
    return { t, message };
  });
  if (input.internal) return { messageId: message.id, email: null };
  const base = process.env.USER_APP_URL ?? process.env.APP_URL ?? "";
  const link = `${base}/help/contact-realy/${t.id}`;
  let email: string | null = null;
  try {
    const r = await sendPlainEmail({
      to: t.requesterEmail,
      subject: `[Realy support #${t.number}] ${t.subject}`,
      text: `${input.body}\n\n—\nReply or follow this ticket: ${link}`,
      template: "platform_support.reply",
      organizationId: t.organizationId,
      userId: t.requesterId,
    });
    email = r.status;
    if (r.id) await db().platformSupportMessage.update({ where: { id: message.id }, data: { emailMessageId: r.id } });
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticketId: t.id }, "support reply email not recorded");
  }
  return { messageId: message.id, email };
}

export const linkInput = z.object({
  incidentId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{1,40}$/)).max(20).optional(),
  reason: reasonSchema,
});

/** Link a ticket to a platform incident (stream E id) and/or an organization, and set its tags. */
export async function linkTicket(ctx: RequestContext, ticketId: string, raw: z.input<typeof linkInput>) {
  const input = linkInput.parse(raw);
  return transaction(async (tx) => {
    const t = await loadForUpdate(tx, ctx, ticketId);
    if (input.organizationId) {
      const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
      if (!org) throw notFound("Organization");
    }
    const data = {
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      ...(input.tags ? { tags: [...new Set(input.tags)] } : {}),
    };
    await tx.platformSupportTicket.update({ where: { id: t.id }, data });
    await audit(tx, ctx, t, "linked", { incidentId: t.incidentId, organizationId: t.organizationId, tags: t.tags }, data, input.reason);
    return data;
  });
}

// ───────────────────────────── Customer health ─────────────────────────────

/**
 * Customer health for one organization (aggregates only; tenant records stay behind the audited tenant view):
 * usage (API requests, AI tasks, active members), subscription, activity, support history, adoption, and risk
 * signals with the rule that raised each one. No score is invented: risks are explicit, named conditions.
 */
export async function customerHealth(ctx: RequestContext, organizationId: string) {
  await requireAnyPlatform(ctx, READ);
  if (!isUuid(organizationId)) throw notFound("Organization");
  const org = await db().organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, status: true, createdAt: true } });
  if (!org) throw notFound("Organization");
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);
  const [members, memberIds, sub, apiReq, tasks, failedTasks, employees, companies, integrations, audit30, tickets, openUrgent] = await Promise.all([
    db().membership.count({ where: { organizationId, status: "ACTIVE" } }),
    db().membership.findMany({ where: { organizationId, status: "ACTIVE" }, select: { userId: true }, take: 2000 }),
    db().subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, interval: true, currency: true, currentPeriodEnd: true, trialEndsAt: true, cancelAtPeriodEnd: true, lastPaymentFailedAt: true, plan: { select: { key: true, name: true } } } }),
    db().usageRecord.aggregate({ where: { organizationId, meter: "api.request", occurredAt: { gte: d30 } }, _sum: { quantity: true } }),
    db().agentTask.count({ where: { organizationId, createdAt: { gte: d30 } } }),
    db().agentTask.count({ where: { organizationId, createdAt: { gte: d30 }, status: "FAILED" } }),
    db().aiEmployee.count({ where: { organizationId } }),
    db().company.count({ where: { organizationId } }),
    db().integrationConnection.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    db().auditLog.count({ where: { organizationId, createdAt: { gte: d30 } } }),
    db().platformSupportTicket.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    db().platformSupportTicket.count({ where: { organizationId, priority: { in: ["HIGH", "URGENT"] }, status: { in: OPEN_STATUSES } } }),
  ]);
  const ids = memberIds.map((m) => m.userId);
  const [active7, lastSeen] = await Promise.all([
    ids.length ? db().session.findMany({ where: { userId: { in: ids }, lastSeenAt: { gte: d7 } }, distinct: ["userId"], select: { userId: true } }) : [],
    ids.length ? db().session.findFirst({ where: { userId: { in: ids } }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }) : null,
  ]);
  const conn = (s: string) => integrations.find((i) => i.status === s)?._count._all ?? 0;
  const ticketCount = (s: string) => tickets.find((t) => t.status === s)?._count._all ?? 0;
  const openTickets = OPEN_STATUSES.reduce((n, s) => n + ticketCount(s), 0);
  const risks: { key: string; severity: "high" | "medium" }[] = [];
  if (org.status === "SUSPENDED") risks.push({ key: "suspended", severity: "high" });
  if (sub?.status === "PAST_DUE" || sub?.status === "UNPAID") risks.push({ key: "paymentFailing", severity: "high" });
  if (sub?.cancelAtPeriodEnd) risks.push({ key: "cancelling", severity: "high" });
  if (!lastSeen || lastSeen.lastSeenAt < daysAgo(14)) risks.push({ key: "inactive14d", severity: "medium" });
  if (openUrgent > 0) risks.push({ key: "urgentTickets", severity: "medium" });
  if (tasks >= 20 && failedTasks / tasks > 0.2) risks.push({ key: "aiFailures", severity: "medium" });
  if (conn("ERROR") > 0) risks.push({ key: "integrationErrors", severity: "medium" });
  return {
    organization: org,
    usage: { members, activeMembers7d: active7.length, apiRequests30d: Number(apiReq._sum.quantity ?? 0), aiTasks30d: tasks, aiFailed30d: failedTasks },
    subscription: sub,
    activity: { lastSeenAt: lastSeen?.lastSeenAt ?? null, auditEvents30d: audit30 },
    support: { open: openTickets, total: tickets.reduce((n, t) => n + t._count._all, 0), byStatus: Object.fromEntries(tickets.map((t) => [t.status, t._count._all])) as Record<string, number> },
    adoption: { companies, aiEmployees: employees, integrationsConnected: conn("CONNECTED"), integrationsError: conn("ERROR"), activeShare: members ? active7.length / members : null },
    risks,
  };
}
