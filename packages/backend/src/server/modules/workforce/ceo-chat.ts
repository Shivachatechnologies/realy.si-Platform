import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { writeAudit } from "@/server/modules/audit/service";
import { createTask } from "@/server/modules/agents/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

/** "Ask the CEO": each question is an ai_ceo task (subject ceo_conversation:<id>); the answer is the task's deliverable. */
export const CEO_SUBJECT = "ceo_conversation";
/** Suggested questions (i18n keys under intelligence.chat.suggestions). */
export const SUGGESTED_QUESTIONS = ["performance", "revenue", "deals", "leads", "decisions", "projects", "cash", "marketing", "customers", "today"] as const;

export const askInput = z.object({ conversationId: z.string().uuid().optional(), question: z.string().trim().min(2).max(4000) });
export const conversationUpdateInput = z.object({ title: z.string().trim().min(1).max(120) });

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
/** Earlier turns included as context with a new question. */
const CONTEXT_TURNS = 6;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.run") {
  await requirePermission(ctx, permission, await companyChain(db(), organizationId, companyId));
}

const mine = (ctx: RequestContext, organizationId: string, companyId: string) => ({ organizationId, companyId, createdById: ctx.actor.id ?? "", archivedAt: null });

export async function listConversations(ctx: RequestContext, organizationId: string, companyId: string, raw: { q?: string; cursor?: string; limit?: number } = {}) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  const page = pageInput.parse({ limit: raw.limit ?? 30, cursor: raw.cursor });
  const q = z.string().trim().max(100).optional().catch(undefined).parse(raw.q);
  const rows = await db().ceoConversation.findMany({
    where: { ...mine(ctx, organizationId, companyId), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { messages: { some: { content: { contains: q, mode: "insensitive" as const } } } }] } : {}) },
    orderBy: { id: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

/** One of the viewer's threads with its messages and the status of each question's task. */
export async function getConversation(ctx: RequestContext, organizationId: string, companyId: string, conversationId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  if (!isUuid(conversationId)) throw notFound("Conversation");
  const c = await db().ceoConversation.findFirst({ where: { id: conversationId, ...mine(ctx, organizationId, companyId) }, include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } } });
  if (!c) throw notFound("Conversation");
  const taskIds = c.messages.map((m) => m.taskId).filter((x): x is string => !!x);
  const tasks = taskIds.length
    ? await db().agentTask.findMany({ where: { id: { in: taskIds }, organizationId, companyId }, select: { id: true, status: true, output: true, errorMessage: true, toolCalls: true } })
    : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const answered = new Set(c.messages.filter((m) => m.role === "ASSISTANT" && m.taskId).map((m) => m.taskId!));
  return {
    ...c,
    messages: c.messages.map((m) => {
      const t = m.taskId ? byId.get(m.taskId) : undefined;
      // A completed answer not yet copied into the thread (event pending) is shown from the task itself.
      return { ...m, task: t ? { id: t.id, status: t.status, errorMessage: t.errorMessage, pendingOutput: m.role === "USER" && !answered.has(t.id) && t.status === "COMPLETED" ? t.output : null } : null };
    }),
  };
}

/** Ask a question (new thread unless conversationId is given). The AI CEO employee answers it, or the ai_ceo role. */
export async function askCeo(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof askInput>) {
  const input = askInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.run");
  let conversationId = input.conversationId ?? null;
  let history: { role: string; content: string }[] = [];
  if (conversationId) {
    const c = await db().ceoConversation.findFirst({ where: { id: conversationId, ...mine(ctx, organizationId, companyId) }, select: { id: true } });
    if (!c) throw notFound("Conversation");
    history = (await db().ceoMessage.findMany({ where: { conversationId, companyId }, orderBy: { createdAt: "desc" }, take: CONTEXT_TURNS, select: { role: true, content: true } })).reverse();
  }
  const isNew = !conversationId;
  conversationId ??= randomUUID();
  const ceo = await db().aiEmployee.findFirst({ where: { organizationId, companyId, profileKey: "ai_ceo", status: "ACTIVE", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const instructions = [
    "The founder asks you a question in the Ask the CEO chat. Answer it directly in the first lines, then give the evidence (numbers from your tools, with the period) and concrete next steps with owners. Link records as in-app paths (e.g. /crm/deals/<id>, /tasks/<id>, /finance, /projects/<id>) so they can be opened. Never invent numbers; say when data is unavailable. Delegate follow-up work only when the founder asks you to act.",
    history.length ? `Earlier in this conversation (oldest first):\n${history.map((h) => `${h.role === "USER" ? "Founder" : "You"}: ${h.content.slice(0, 1500)}`).join("\n\n")}` : null,
    `Question:\n${input.question}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);
  const task = await createTask(ctx, organizationId, companyId, {
    ...(ceo ? { aiEmployeeId: ceo.id } : { profile: "ai_ceo" }),
    title: `CEO question: ${input.question}`.slice(0, 200),
    instructions,
    subject: { type: CEO_SUBJECT, id: conversationId },
  });
  const id = conversationId;
  return transaction(async (tx) => {
    if (isNew) await tx.ceoConversation.create({ data: { id, organizationId, companyId, title: input.question.slice(0, 120), createdById: ctx.actor.id ?? organizationId } });
    else await tx.ceoConversation.update({ where: { id }, data: { updatedAt: new Date() } });
    const m = await tx.ceoMessage.create({ data: { organizationId, companyId, conversationId: id, role: "USER", content: input.question, taskId: task.id, createdById: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ceo_chat.asked", resourceType: "ceo_conversation", resourceId: id, newValue: { companyId, messageId: m.id, taskId: task.id } });
    return { conversationId: id, messageId: m.id, taskId: task.id };
  });
}

export async function renameConversation(ctx: RequestContext, organizationId: string, companyId: string, conversationId: string, raw: z.input<typeof conversationUpdateInput>) {
  const { title } = conversationUpdateInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.read");
  if (!isUuid(conversationId)) throw notFound("Conversation");
  const { count } = await db().ceoConversation.updateMany({ where: { id: conversationId, ...mine(ctx, organizationId, companyId) }, data: { title } });
  if (!count) throw notFound("Conversation");
  return { ok: true };
}

export async function archiveConversation(ctx: RequestContext, organizationId: string, companyId: string, conversationId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  if (!isUuid(conversationId)) throw notFound("Conversation");
  return transaction(async (tx) => {
    const { count } = await tx.ceoConversation.updateMany({ where: { id: conversationId, ...mine(ctx, organizationId, companyId) }, data: { archivedAt: new Date() } });
    if (!count) throw notFound("Conversation");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ceo_chat.archived", resourceType: "ceo_conversation", resourceId: conversationId, newValue: { companyId } });
    return { ok: true };
  });
}

/** agent.task.completed for a CEO question → the answer is stored in the thread (once per task). */
export async function handleCeoAnswer(event: OutboxEvent): Promise<void> {
  if (event.type !== "agent.task.completed" || !event.organizationId || !event.companyId) return;
  const data = ((event.payload ?? {}) as { data?: { subjectType?: string; subjectId?: string } }).data ?? {};
  if (data.subjectType !== CEO_SUBJECT || !data.subjectId) return;
  const { organizationId, companyId } = event;
  const task = await db().agentTask.findFirst({ where: { id: event.aggregateId, organizationId, companyId, status: "COMPLETED" }, select: { id: true, output: true } });
  if (!task?.output) return;
  const conv = await db().ceoConversation.findFirst({ where: { id: data.subjectId, organizationId, companyId }, select: { id: true } });
  if (!conv || (await db().ceoMessage.count({ where: { conversationId: conv.id, taskId: task.id, role: "ASSISTANT" } }))) return;
  await db().ceoMessage.create({ data: { organizationId, companyId, conversationId: conv.id, role: "ASSISTANT", content: task.output, taskId: task.id } });
  await db().ceoConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
}
