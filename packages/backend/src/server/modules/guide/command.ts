import "server-only";
import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { profileByKey } from "@/server/modules/agents/profiles";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { DEFAULT_LOCALE, isAppLocale, LOCALES, type AppLocale } from "@/i18n/config";
import { isUuid, resolveGuidePage, stripLocale } from "./pages";
import { countMetrics, onboardingState } from "./state";
import { recommend, REC_METRICS } from "./recommendations";
import { advanceRun, cancelRun, deriveStages, MAX_STEP_ATTEMPTS, retryStep, STAGES, startRun, type Understanding } from "./command-run";
import { FALLBACK, routeCommand } from "./command-intents";
import { understandCommand } from "./command-intent";


export { COMMAND_INTENTS, routeCommand, type RoutedIntent } from "./command-intents";

async function authorize(ctx: RequestContext, organizationId: string, companyId: string): Promise<ScopeChain> {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  return chain;
}

function userId(ctx: RequestContext): string {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("AI Command is available to signed-in people only");
  return ctx.actor.id;
}

export const commandInput = z.object({
  text: z.string().trim().min(2).max(2000),
  sessionId: z.string().uuid().optional(),
  locale: z.string().max(10).optional(),
  /** Browser path the command was given from (page context), when sent from the guide panel. */
  path: z.string().max(400).optional(),
  /** "ceo": the AI CEO takes the command and decides who does what (Ask the CEO). */
  mode: z.enum(["auto", "ceo"]).optional(),
  /** The run whose recommended next action this command carries out. */
  parentRunId: z.string().uuid().optional(),
});

/**
 * Run one command: understand it (intents, real company counts, matching company knowledge), persist a plan of steps
 * (research → departments → review) and delegate the first steps as real agent tasks — preferring the company's hired
 * AI employee for each role. Task-creation failures (AI not configured, budget, permission) are kept on the step so
 * the workspace shows why; nothing is reported as running that is not.
 */
export async function runCommand(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof commandInput>) {
  const input = commandInput.parse(raw);
  const chain = await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  const scope = { organizationId, companyId };
  const locale: AppLocale = isAppLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const existing = input.sessionId
    ? await db().commandSession.findFirst({ where: { ...scope, id: input.sessionId, userId: uid }, select: { id: true } })
    : null;
  if (input.sessionId && !existing) throw notFound("Command session");

  const parent = input.parentRunId ? await db().commandRun.findFirst({ where: { ...scope, id: input.parentRunId }, select: { id: true } }) : null;
  // Understanding (B26): the fast-tier classifier with the keyword map as fallback; "ceo" mode always goes to the AI CEO.
  const understood =
    input.mode === "ceo" && profileByKey(FALLBACK.profile)
      ? { intents: [{ key: FALLBACK.key, profile: FALLBACK.profile, score: 0 }], research: null, dependsOn: {}, source: "keywords" as const }
      : (await can(ctx, "agents.run", chain))
        ? await understandCommand(scope, input.text, `${uid}:${input.sessionId ?? "new"}:${Date.now()}`)
        : // Without permission to run AI work, no AI spend: route by keywords (the steps then report the missing permission).
          { intents: routeCommand(input.text), research: null, dependsOn: {}, source: "keywords" as const };
  const team = understood.intents;
  const counts = await countMetrics(ctx, scope, chain, REC_METRICS);
  const facts = Object.fromEntries(Object.entries(counts).filter((e): e is [string, number] => typeof e[1] === "number"));
  const page = input.path ? resolveGuidePage(stripLocale(input.path, LOCALES)).path || "/" : null;

  const { session, message } = await transaction(async (tx) => {
    const s = existing
      ? await tx.commandSession.update({ where: { id: existing.id }, data: { updatedAt: new Date() }, select: { id: true } })
      : await tx.commandSession.create({ data: { ...scope, userId: uid, title: input.text.slice(0, 120) }, select: { id: true } });
    const m = await tx.commandMessage.create({ data: { ...scope, sessionId: s.id, role: "USER", content: input.text }, select: { id: true } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "guide.command.created",
      resourceType: "command_session",
      resourceId: s.id,
      newValue: { companyId, intents: team.map((i) => i.key) },
    });
    return { session: s, message: m };
  });
  await startRun(ctx, scope, { sessionId: session.id, messageId: message.id, userId: uid, text: input.text, locale, intents: team, facts, page, parentRunId: parent?.id ?? null, plan: { research: understood.research, dependsOn: understood.dependsOn, source: understood.source } });
  return getCommandSession(ctx, organizationId, companyId, session.id);
}

const TASK_SELECT = {
  id: true,
  title: true,
  profile: true,
  status: true,
  output: true,
  toolCalls: true,
  errorCode: true,
  errorMessage: true,
  aiEmployeeId: true,
  parentTaskId: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} as const;

/**
 * A command conversation with live state: each command's run (understanding, plan steps, stages) with every step's
 * agent task, its trace, delegated child tasks and approvals. Unfinished runs are advanced first (idempotent), so
 * waiting steps are delegated as soon as their dependencies finish even without the worker event.
 */
export async function getCommandSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  if (!isUuid(sessionId)) throw notFound("Command session");
  const scope = { organizationId, companyId };
  const head = await db().commandSession.findFirst({ where: { ...scope, id: sessionId, userId: uid }, select: { id: true } });
  if (!head) throw notFound("Command session");
  const open = await db().commandRun.findMany({ where: { ...scope, sessionId, status: { in: ["PLANNED", "RUNNING", "REVIEWING"] } }, select: { id: true } });
  for (const r of open) {
    try {
      await advanceRun(ctx, scope, r.id);
    } catch {
      /* shown from the rows as they are */
    }
  }
  const session = await db().commandSession.findFirst({
    where: { ...scope, id: sessionId, userId: uid },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
      commandRuns: { orderBy: { createdAt: "asc" }, take: 100, include: { steps: { orderBy: { position: "asc" } } } },
    },
  });
  if (!session) throw notFound("Command session");
  const taskIds = [...session.messages.map((m) => m.taskId), ...session.commandRuns.flatMap((r) => r.steps.map((st) => st.taskId))].filter((v): v is string => !!v);
  const tasks = taskIds.length ? await db().agentTask.findMany({ where: { ...scope, id: { in: taskIds } }, select: TASK_SELECT }) : [];
  const children = taskIds.length ? await db().agentTask.findMany({ where: { ...scope, parentTaskId: { in: taskIds } }, select: TASK_SELECT, orderBy: { createdAt: "asc" } }) : [];
  const allIds = [...taskIds, ...children.map((c) => c.id)];
  const [approvals, canDecide, canRun] = await Promise.all([
    allIds.length
      ? db().approval.findMany({ where: { ...scope, taskId: { in: allIds } }, orderBy: { createdAt: "asc" }, select: { id: true, taskId: true, tool: true, summary: true, status: true, risk: true, error: true, attempts: true, createdAt: true } })
      : [],
    can(ctx, "approvals.decide", chain),
    can(ctx, "agents.run", chain),
  ]);
  const employeeIds = [...new Set([...tasks, ...children].map((x) => x.aiEmployeeId).filter((v): v is string => !!v))];
  const employees = employeeIds.length ? await db().aiEmployee.findMany({ where: { ...scope, id: { in: employeeIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));
  const view = (task: (typeof tasks)[number]) => {
    const calls = Array.isArray(task.toolCalls) ? (task.toolCalls as { tool?: unknown; error?: unknown }[]) : [];
    return {
      id: task.id,
      title: task.title,
      profile: task.profile,
      employeeName: task.aiEmployeeId ? (nameOf.get(task.aiEmployeeId) ?? null) : null,
      status: task.status as string,
      output: task.output,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      trace: calls.map((c) => ({ tool: typeof c.tool === "string" ? c.tool : "unknown", failed: !!c.error })),
      approvals: approvals.filter((a) => a.taskId === task.id),
    };
  };
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const childrenOf = (id: string) => children.filter((c) => c.parentTaskId === id).map(view);
  const runs = session.commandRuns.map((r) => {
    const steps = r.steps.map((st) => {
      const task = st.taskId ? byId.get(st.taskId) : undefined;
      return {
        id: st.id,
        position: st.position,
        kind: st.kind as "RESEARCH" | "DEPARTMENT" | "REVIEW",
        intent: st.intent,
        profile: st.profile,
        title: st.title,
        dependsOn: st.dependsOn,
        status: st.status as string,
        errorReason: st.errorReason,
        delegatedAt: st.delegatedAt,
        attempts: st.attempts,
        canRetry: st.attempts < MAX_STEP_ATTEMPTS && (st.status === "BLOCKED" || (st.status === "DELEGATED" && (task?.status === "FAILED" || task?.status === "CANCELLED"))) && r.status !== "CANCELLED",
        task: task ? view(task) : null,
        children: task ? childrenOf(task.id) : [],
      };
    });
    const u = r.understanding as unknown as Understanding;
    return {
      id: r.id,
      messageId: r.messageId,
      text: r.text,
      status: r.status as string,
      nextAction: r.nextAction,
      origin: r.origin as string,
      documentId: r.documentId,
      documentError: r.documentError,
      parentRunId: r.parentRunId,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      understanding: { intents: u.intents ?? [], research: !!u.research, facts: u.facts ?? {}, sources: u.sources ?? [], page: u.page ?? null, brief: u.brief ?? null, classifier: u.classifier ?? "keywords" },
      stages: deriveStages(r, steps.map((st) => ({ kind: st.kind, status: st.status, task: st.task ? { status: st.task.status, approvals: st.task.approvals, children: st.children } : null }))),
      steps,
    };
  });
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    canDecide,
    canRun,
    stageOrder: STAGES,
    runs,
    messages: session.messages.map((m) => {
      const task = m.taskId ? byId.get(m.taskId) : undefined;
      return {
        id: m.id,
        role: m.role as "USER" | "ASSISTANT",
        content: m.content,
        intent: m.intent,
        profile: m.profile,
        errorReason: m.errorReason,
        createdAt: m.createdAt,
        task: task ? view(task) : null,
        children: task ? childrenOf(task.id) : [],
      };
    }),
  };
}

/** Cancel one of the viewer's command runs. */
export async function cancelCommandRun(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string, runId: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  if (!isUuid(sessionId) || !isUuid(runId)) throw notFound("Command run");
  const run = await db().commandRun.findFirst({ where: { organizationId, companyId, id: runId, sessionId, userId: uid }, select: { id: true } });
  if (!run) throw notFound("Command run");
  await cancelRun(ctx, { organizationId, companyId }, uid, run.id);
  return getCommandSession(ctx, organizationId, companyId, sessionId);
}

/** Retry a failed or blocked step of one of the viewer's command runs. */
export async function retryCommandStep(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string, runId: string, stepId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  await requirePermission(ctx, "agents.run", chain);
  const uid = userId(ctx);
  if (!isUuid(sessionId) || !isUuid(runId) || !isUuid(stepId)) throw notFound("Command run");
  const run = await db().commandRun.findFirst({ where: { organizationId, companyId, id: runId, sessionId, userId: uid }, select: { id: true } });
  if (!run) throw notFound("Command run");
  await retryStep(ctx, { organizationId, companyId }, run.id, stepId);
  return getCommandSession(ctx, organizationId, companyId, sessionId);
}

/**
 * Live AI command activity for the Command Center: the company's most recent runs (all members' — names only, no
 * outputs) with their stage states, plus the viewer's own. Null when the viewer may not read AI work.
 */
export async function liveCommandRuns(ctx: RequestContext, organizationId: string, companyId: string, take = 6) {
  const chain = await authorize(ctx, organizationId, companyId);
  if (!(await can(ctx, "agents.read", chain))) return null;
  const scope = { organizationId, companyId };
  const runs = await db().commandRun.findMany({
    where: scope,
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, sessionId: true, userId: true, text: true, status: true, nextAction: true, updatedAt: true, steps: { orderBy: { position: "asc" }, select: { kind: true, status: true, profile: true, taskId: true } } },
  });
  const taskIds = runs.flatMap((r) => r.steps.map((s) => s.taskId)).filter((v): v is string => !!v);
  const [tasks, approvals, kids] = taskIds.length
    ? await Promise.all([
        db().agentTask.findMany({ where: { ...scope, id: { in: taskIds } }, select: { id: true, status: true } }),
        db().approval.findMany({ where: { ...scope, taskId: { in: taskIds } }, select: { taskId: true, status: true } }),
        db().agentTask.findMany({ where: { ...scope, parentTaskId: { in: taskIds } }, select: { parentTaskId: true, status: true } }),
      ])
    : [[], [], []];
  const status = new Map(tasks.map((x) => [x.id, x.status as string]));
  const uid = ctx.actor.id;
  return runs.map((r) => {
    const steps = r.steps.map((s) => ({
      kind: s.kind as string,
      status: s.status as string,
      profile: s.profile,
      task: s.taskId ? { status: status.get(s.taskId) ?? "QUEUED", approvals: approvals.filter((a) => a.taskId === s.taskId), children: kids.filter((k) => k.parentTaskId === s.taskId) } : null,
    }));
    return {
      id: r.id,
      sessionId: r.userId === uid ? r.sessionId : null,
      mine: r.userId === uid,
      text: r.userId === uid ? r.text : null,
      status: r.status as string,
      nextAction: r.userId === uid ? r.nextAction : null,
      updatedAt: r.updatedAt,
      profiles: [...new Set(steps.map((s) => s.profile))],
      pendingApprovals: approvals.filter((a) => a.status === "PENDING").length,
      stages: deriveStages(r, steps),
    };
  });
}
export type CommandSessionView = Awaited<ReturnType<typeof getCommandSession>>;

/** The viewer's command history (newest first). */
export async function listCommandSessions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  return db().commandSession.findMany({
    where: { organizationId, companyId, userId: uid },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
  });
}

export async function deleteCommandSession(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string) {
  await authorize(ctx, organizationId, companyId);
  const uid = userId(ctx);
  if (!isUuid(sessionId)) throw notFound("Command session");
  return transaction(async (tx) => {
    const s = await tx.commandSession.findFirst({ where: { organizationId, companyId, id: sessionId, userId: uid }, select: { id: true } });
    if (!s) throw notFound("Command session");
    await tx.commandSession.delete({ where: { id: s.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "guide.command.deleted", resourceType: "command_session", resourceId: s.id });
    return { ok: true };
  });
}

/** Suggested commands from the company's real state (keys of guide.command.suggest.*) plus AI readiness. */
export async function commandSuggestions(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await authorize(ctx, organizationId, companyId);
  const scope = { organizationId, companyId };
  const [counts, onboarding, canRun] = await Promise.all([countMetrics(ctx, scope, chain, REC_METRICS), onboardingState(scope), can(ctx, "agents.run", chain)]);
  const fromState = recommend(counts, onboarding, 4).map((r) => r.key);
  const base = ["customers", "campaign", "product", "financeReport"];
  return { suggestions: [...new Set([...fromState, ...base])].slice(0, 6), ai: { configured: aiConfigured(), canRun } };
}
