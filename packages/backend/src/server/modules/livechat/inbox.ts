import { z } from "zod";
import type { LivechatStatus } from "@/generated/prisma/enums";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { addEvent } from "./actions";
import { authorize, ensureSettings, isUuid, OUTCOMES, STATUSES } from "./common";
import { closeConversationTx } from "./lifecycle";

export const listFilters = z.object({
  status: z.enum(["open", "waiting", "ai", "human", "closed", "all"]).catch("open").default("open"),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(500).catch(1).default(1),
});
export const replyInput = z.object({ body: z.string().trim().min(1).max(4000) });
export const outcomesInput = z.object({ outcomes: z.array(z.enum(OUTCOMES)).max(OUTCOMES.length) });
export const pollQuery = z.object({ after: z.string().datetime().optional().catch(undefined) });

const PAGE = 30;
const STATUS_FILTER: Record<string, LivechatStatus[] | undefined> = {
  open: ["AI_ACTIVE", "WAITING_HUMAN", "HUMAN_ACTIVE"],
  waiting: ["WAITING_HUMAN"],
  ai: ["AI_ACTIVE"],
  human: ["HUMAN_ACTIVE"],
  closed: ["CLOSED"],
  all: undefined,
};

export async function listConversations(ctx: RequestContext, organizationId: string, companyId: string, raw: Record<string, unknown> = {}) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const f = listFilters.parse(raw);
  const statuses = STATUS_FILTER[f.status];
  const where: Prisma.LivechatConversationWhereInput = {
    organizationId,
    companyId,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(f.q
      ? {
          OR: [
            { visitor: { name: { contains: f.q, mode: "insensitive" } } },
            { visitor: { email: { contains: f.q, mode: "insensitive" } } },
            { messages: { some: { body: { contains: f.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db().livechatConversation.findMany({
      where,
      // Waiting chats first, then most recent activity.
      orderBy: [{ lastMessageAt: "desc" }],
      skip: (f.page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true,
        status: true,
        outcomes: true,
        locale: true,
        pageUrl: true,
        messageCount: true,
        lastMessageAt: true,
        createdAt: true,
        assigneeId: true,
        visitor: { select: { id: true, name: true, email: true } },
        messages: { where: { kind: "text" }, orderBy: { createdAt: "desc" }, take: 1, select: { author: true, body: true } },
      },
    }),
    db().livechatConversation.count({ where }),
    db().livechatConversation.groupBy({ by: ["status"], where: { organizationId, companyId }, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count._all ?? 0])) as Record<LivechatStatus, number>;
  return {
    filters: f,
    total,
    pageSize: PAGE,
    counts: byStatus,
    data: rows.map(({ messages, ...r }) => ({ ...r, last: messages[0] ? { author: messages[0].author, body: messages[0].body.slice(0, 160) } : null })),
  };
}

async function loadConversation(organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Conversation");
  const c = await db().livechatConversation.findFirst({ where: { id, organizationId, companyId } });
  if (!c) throw notFound("Conversation");
  return c;
}

const messageSelect = { id: true, author: true, authorUserId: true, kind: true, body: true, meta: true, createdAt: true } as const;

export async function getConversation(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const c = await loadConversation(organizationId, companyId, id);
  const [visitor, messages, lead, ticket, approval, otherCount] = await Promise.all([
    db().livechatVisitor.findFirstOrThrow({ where: { id: c.visitorId, companyId }, select: { id: true, name: true, email: true, consentAt: true, consentText: true, locale: true, userAgent: true, firstSeenAt: true, lastSeenAt: true } }),
    db().livechatMessage.findMany({ where: { conversationId: c.id, companyId }, orderBy: { createdAt: "asc" }, take: 500, select: messageSelect }),
    c.leadId ? db().lead.findFirst({ where: { id: c.leadId, organizationId, companyId }, select: { id: true, name: true, stage: true } }) : null,
    c.ticketId ? db().supportTicket.findFirst({ where: { id: c.ticketId, organizationId, companyId }, select: { id: true, number: true, subject: true, status: true } }) : null,
    c.meetingApprovalId ? db().approval.findFirst({ where: { id: c.meetingApprovalId, organizationId, companyId }, select: { id: true, status: true, summary: true } }) : null,
    db().livechatConversation.count({ where: { companyId, organizationId, visitorId: c.visitorId, id: { not: c.id } } }),
  ]);
  const userIds = [...new Set([c.assigneeId, ...messages.map((m) => m.authorUserId)].filter((x): x is string => !!x))];
  const users = userIds.length ? await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const now = Date.now();
  const live = { aiThinking: !!(c.aiBusyUntil && c.aiBusyUntil.getTime() > now), visitorOnline: !!(c.visitorSeenAt && now - c.visitorSeenAt.getTime() < 30_000) };
  return { conversation: c, visitor, messages, lead, ticket, meetingApproval: approval, otherConversations: otherCount, names, live };
}

/** Live view polling: new messages and state since `after`. */
export async function pollConversation(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: Record<string, unknown> = {}) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const { after } = pollQuery.parse(raw);
  const c = await loadConversation(organizationId, companyId, id);
  const messages = await db().livechatMessage.findMany({ where: { conversationId: c.id, companyId, ...(after ? { createdAt: { gt: new Date(after) } } : {}) }, orderBy: { createdAt: "asc" }, take: 200, select: messageSelect });
  const now = Date.now();
  return {
    status: c.status,
    assigneeId: c.assigneeId,
    outcomes: c.outcomes,
    aiThinking: !!(c.aiBusyUntil && c.aiBusyUntil.getTime() > now),
    visitorOnline: !!(c.visitorSeenAt && now - c.visitorSeenAt.getTime() < 30_000),
    messages,
  };
}

/** A person replies: the conversation becomes human-handled (the AI stops answering) and is assigned to them. */
export async function agentReply(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof replyInput>) {
  const { body } = replyInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const c = await loadConversation(organizationId, companyId, id);
    if (c.status === "CLOSED") throw conflict("This conversation is closed", { reason: "livechat_closed" });
    if (c.status !== "HUMAN_ACTIVE" || c.assigneeId !== ctx.actor.id) {
      await tx.livechatConversation.update({ where: { id: c.id }, data: { status: "HUMAN_ACTIVE", assigneeId: ctx.actor.id } });
      if (c.status !== "HUMAN_ACTIVE") await addEvent(tx, c, "agent_joined");
    }
    const m = await tx.livechatMessage.create({ data: { organizationId, companyId, conversationId: c.id, author: "AGENT", authorUserId: ctx.actor.id, body } });
    await tx.livechatConversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date(), messageCount: { increment: 1 }, agentTypingAt: null } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.agent_replied", resourceType: "livechat_conversation", resourceId: c.id });
    return m;
  });
}

export async function takeOver(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const c = await loadConversation(organizationId, companyId, id);
    if (c.status === "CLOSED") throw conflict("This conversation is closed", { reason: "livechat_closed" });
    await tx.livechatConversation.update({ where: { id: c.id }, data: { status: "HUMAN_ACTIVE", assigneeId: ctx.actor.id } });
    if (c.status !== "HUMAN_ACTIVE") await addEvent(tx, c, "agent_joined");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.taken_over", resourceType: "livechat_conversation", resourceId: c.id });
    return { ok: true };
  });
}

export async function returnToAi(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const settings = await ensureSettings(tx, organizationId, companyId);
    if (!settings.aiEnabled) throw conflict("The AI assistant is turned off in the chat settings", { reason: "livechat_ai_off" });
    const c = await loadConversation(organizationId, companyId, id);
    if (c.status === "CLOSED") throw conflict("This conversation is closed", { reason: "livechat_closed" });
    await tx.livechatConversation.update({ where: { id: c.id }, data: { status: "AI_ACTIVE", assigneeId: null, agentTypingAt: null } });
    await addEvent(tx, c, "ai_returned");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.returned_to_ai", resourceType: "livechat_conversation", resourceId: c.id });
    return { ok: true };
  });
}

export async function closeConversation(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    await loadConversation(organizationId, companyId, id);
    await closeConversationTx(tx, ctx, id, companyId, "agent");
    return { ok: true };
  });
}

export async function setOutcomes(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof outcomesInput>) {
  const { outcomes } = outcomesInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const c = await loadConversation(organizationId, companyId, id);
    await tx.livechatConversation.update({ where: { id: c.id }, data: { outcomes: [...new Set(outcomes)] } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.outcomes.updated", resourceType: "livechat_conversation", resourceId: c.id, oldValue: { outcomes: c.outcomes }, newValue: { outcomes } });
    return { ok: true };
  });
}

/** The agent is typing (shown to the visitor for a few seconds). */
export async function agentTyping(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  await authorize(ctx, organizationId, companyId, "support.manage");
  if (!isUuid(id)) throw notFound("Conversation");
  await db().livechatConversation.updateMany({ where: { id, organizationId, companyId, status: "HUMAN_ACTIVE" }, data: { agentTypingAt: new Date() } });
  return { ok: true };
}

/**
 * GDPR erasure: deletes the visitor, all their conversations and messages. Leads and tickets created from the chat are
 * separate records in CRM / Support (the response lists them so they can be erased there too).
 */
export async function deleteVisitorData(ctx: RequestContext, organizationId: string, companyId: string, visitorId: string) {
  if (!isUuid(visitorId)) throw notFound("Visitor");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const v = await tx.livechatVisitor.findFirst({ where: { id: visitorId, organizationId, companyId }, select: { id: true, leadId: true } });
    if (!v) throw notFound("Visitor");
    const convs = await tx.livechatConversation.findMany({ where: { visitorId: v.id, companyId }, select: { leadId: true, ticketId: true }, orderBy: { createdAt: "desc" }, take: 200 });
    await tx.livechatVisitor.delete({ where: { id: v.id } });
    const leadIds = [...new Set([v.leadId, ...convs.map((c) => c.leadId)].filter((x): x is string => !!x))];
    const ticketIds = [...new Set(convs.map((c) => c.ticketId).filter((x): x is string => !!x))];
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.visitor_data_deleted", resourceType: "livechat_visitor", resourceId: v.id, newValue: { conversations: convs.length, leadIds, ticketIds } });
    return { ok: true, conversations: convs.length, leadIds, ticketIds };
  });
}

/** Live chat analytics for a period (days back from now). */
export async function livechatAnalytics(ctx: RequestContext, organizationId: string, companyId: string, days = 30, now = new Date()) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const from = new Date(now.getTime() - days * 86_400_000);
  const base = { organizationId, companyId, createdAt: { gte: from, lt: now } };
  const [total, closed, aiResolved, leads, tickets, handoffs, gaps, meetings, rows] = await Promise.all([
    db().livechatConversation.count({ where: base }),
    db().livechatConversation.count({ where: { ...base, status: "CLOSED" } }),
    db().livechatConversation.count({ where: { ...base, aiResolved: true } }),
    db().livechatConversation.count({ where: { ...base, leadId: { not: null } } }),
    db().livechatConversation.count({ where: { ...base, ticketId: { not: null } } }),
    db().livechatConversation.count({ where: { ...base, handoffAt: { not: null } } }),
    db().livechatConversation.count({ where: { ...base, outcomes: { has: "knowledge_gap" } } }),
    db().livechatConversation.count({ where: { ...base, outcomes: { has: "meeting" } } }),
    db().livechatConversation.findMany({ where: base, select: { createdAt: true, aiResolved: true, handoffAt: true }, take: 20_000 }),
  ]);
  const series: { day: string; conversations: number; aiResolved: number; handoffs: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day: d, conversations: 0, aiResolved: 0, handoffs: 0 });
  }
  const idx = new Map(series.map((s, i) => [s.day, i]));
  for (const r of rows) {
    const i = idx.get(r.createdAt.toISOString().slice(0, 10));
    if (i === undefined) continue;
    series[i]!.conversations++;
    if (r.aiResolved) series[i]!.aiResolved++;
    if (r.handoffAt) series[i]!.handoffs++;
  }
  return { days, total, closed, aiResolved, resolutionRate: closed ? Math.round((aiResolved / closed) * 1000) / 10 : null, leads, tickets, handoffs, knowledgeGaps: gaps, meetings, series };
}

/** Questions the AI could not answer recently (for knowledge to add). */
export async function knowledgeGaps(ctx: RequestContext, organizationId: string, companyId: string, take = 8) {
  await authorize(ctx, organizationId, companyId, "support.read");
  const convs = await db().livechatConversation.findMany({ where: { organizationId, companyId, outcomes: { has: "knowledge_gap" } }, orderBy: { handoffAt: "desc" }, take, select: { id: true, handoffReason: true, handoffAt: true } });
  return convs;
}
