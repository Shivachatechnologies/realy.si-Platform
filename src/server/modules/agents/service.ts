import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { enqueueAgentTask } from "@/server/core/jobs";
import { env } from "@/server/core/env";
import { agentModel, aiRefusal, aiRefusalMessage, assertAiAllowed, assertProfileAllowed, isOrganizationSuspended } from "@/server/core/platform-controls";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { AUTONOMY_GUIDANCE, toolsForAutonomy } from "@/server/modules/workforce/autonomy";
import { assertEmployeeBudget, budgetRefusal, employeeBudget } from "@/server/modules/workforce/budgets";
import { AGENT_TASK_STATUSES } from "./statuses";
import { PROFILE_KEYS, profileByKey } from "./profiles";
import { aiConfigured, REMEMBER_LINE, runTask, TaskError } from "./runtime";

export const createTaskInput = z.object({
  /** Optional milestone (same company) the task advances. */
  milestoneId: z.string().uuid().optional(),
  /** Optional CRM lead (same company) the task is about. */
  leadId: z.string().uuid().optional(),
  /** Optional generic subject (module record) the task is about, e.g. { type: "invoice", id }. */
  subject: z.object({ type: z.string().regex(/^[a-z_]{2,40}$/), id: z.string().uuid() }).optional(),
  /** Role profile; optional when an AI employee is given (its profile is used). */
  profile: z.enum(PROFILE_KEYS).optional(),
  /** Optional AI employee (same company, active, within budget) that does the work. */
  aiEmployeeId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(8000),
}).refine((v) => v.profile || v.aiEmployeeId, { path: ["profile"], message: "Choose an AI employee or a role" });

/** Delegated tasks may nest at most this deep (a person's task is depth 0). */
export const MAX_DELEGATION_DEPTH = 2;
/** Memory notes included in an AI employee's prompt (pinned first, then newest). */
export const MEMORY_IN_PROMPT = 12;

export const taskFilters = z.object({
  aiEmployeeId: z.string().uuid().optional().catch(undefined),
  status: z.enum(AGENT_TASK_STATUSES).optional().catch(undefined),
  profile: z.string().regex(/^[a-z_]{2,60}$/).optional().catch(undefined),
  subjectType: z.string().regex(/^[a-z_]{2,40}$/).optional().catch(undefined),
  parentTaskId: z.string().uuid().optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
});
export type TaskFilters = z.infer<typeof taskFilters>;

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const ACTIVE = ["QUEUED", "RUNNING"] as const;

/** Columns for lists: everything but the (potentially long) output and traces. */
const summaryFields = {
  id: true,
  companyId: true,
  profile: true,
  title: true,
  milestoneId: true,
  leadId: true,
  subjectType: true,
  subjectId: true,
  aiEmployeeId: true,
  parentTaskId: true,
  depth: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  status: true,
  attempts: true,
  errorCode: true,
  createdById: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} satisfies Prisma.AgentTaskSelect;

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.run", tx?: Prisma.TransactionClient) {
  // Foreign or invisible companies resolve to not_found.
  await requirePermission(ctx, permission, await companyChain(tx ?? db(), organizationId, companyId), tx);
}

function requireProvider() {
  if (!aiConfigured()) throw new AppError("not_configured", "AI provider not configured (ANTHROPIC_API_KEY)", { reason: "ai_not_configured" });
}

/** Start of the current UTC day. */
const utcDayStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Tokens a company's AI tasks used today (input + output), and its daily allowance (null = unlimited). */
export async function aiUsageToday(organizationId: string, companyId: string) {
  const limit = env().AI_DAILY_TOKEN_LIMIT || null;
  const r = await db().agentTask.aggregate({
    where: { organizationId, companyId, startedAt: { gte: utcDayStart() } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  const used = (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0);
  return { used, limit, exhausted: limit !== null && used >= limit };
}

async function requireBudget(organizationId: string, companyId: string, profile?: string | null) {
  // Platform AI controls first (Admin → AI & Workforce): kill switch, org AI switch, disabled role/model, platform and
  // per-organization token budgets and the plan's monthly AI tokens.
  await assertAiAllowed(organizationId, { profile, model: await agentModel(env().AGENT_MODEL) });
  const usage = await aiUsageToday(organizationId, companyId);
  if (usage.exhausted) throw new AppError("not_available", "Today's AI allowance for this company is used up; try again tomorrow", { reason: "ai_budget_exhausted", ...usage });
  // Organization-wide daily AI token limit (Settings → Usage).
  const { assertWithinLimit } = await import("@/server/modules/enterprise/policy");
  await assertWithinLimit(organizationId, "aiTokens", { companyId });
}

const jobIdFor = (taskId: string, n: number) => `${taskId}_${n}`;

/** Queue the task; if the queue is unreachable the task is marked FAILED (never left looking queued) and 503 returned. */
async function enqueue(taskId: string, execution: number) {
  try {
    await enqueueAgentTask(taskId, jobIdFor(taskId, execution));
  } catch (err) {
    await db().agentTask.updateMany({
      where: { id: taskId, status: "QUEUED" },
      data: { status: "FAILED", errorCode: "queue_unavailable", errorMessage: "The task queue is unavailable; retry shortly", completedAt: new Date() },
    });
    throw err;
  }
}

/**
 * Create and queue a task. `opts.parentTaskId` (internal: delegation) links it to the delegating task. With an AI
 * employee, the employee must be active and within its monthly token budget.
 */
export async function createTask(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  raw: z.input<typeof createTaskInput>,
  opts: { parentTaskId?: string } = {},
) {
  const input = createTaskInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.run");
  requireProvider();
  await requireBudget(organizationId, companyId, input.profile);
  const task = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    if (input.milestoneId && !(await tx.milestone.findFirst({ where: { id: input.milestoneId, organizationId, companyId }, select: { id: true } }))) {
      throw notFound("Milestone");
    }
    if (input.leadId && !(await tx.lead.findFirst({ where: { id: input.leadId, organizationId, companyId }, select: { id: true } }))) {
      throw notFound("Lead");
    }
    let profile = input.profile;
    if (input.aiEmployeeId) {
      const employee = await tx.aiEmployee.findFirst({
        where: { id: input.aiEmployeeId, organizationId, companyId, archivedAt: null },
        select: { id: true, name: true, status: true, profileKey: true, department: true, model: true, monthlyTokenBudget: true, monthlyCostBudgetCents: true },
      });
      if (!employee) throw notFound("AI employee");
      if (employee.status === "PAUSED") throw conflict(`${employee.name} is paused`, { reason: "workforce_employee_paused" });
      // The employee's own and its department's monthly allowances (tokens and estimated cost).
      await assertEmployeeBudget(organizationId, companyId, employee);
      profile = employee.profileKey as typeof profile;
    }
    if (!profile || !profileByKey(profile)) throw notFound("Profile");
    await assertProfileAllowed(profile);
    let depth = 0;
    if (opts.parentTaskId) {
      const parent = await tx.agentTask.findFirst({ where: { id: opts.parentTaskId, organizationId, companyId }, select: { depth: true } });
      if (!parent) throw notFound("Task");
      depth = parent.depth + 1;
      if (depth > MAX_DELEGATION_DEPTH) throw conflict("Delegation is limited to two levels", { reason: "workforce_delegation_too_deep" });
    }
    const t = await tx.agentTask.create({
      data: {
        organizationId,
        companyId,
        profile,
        title: input.title,
        instructions: input.instructions,
        milestoneId: input.milestoneId ?? null,
        leadId: input.leadId ?? null,
        subjectType: input.subject?.type ?? null,
        subjectId: input.subject?.id ?? null,
        aiEmployeeId: input.aiEmployeeId ?? null,
        parentTaskId: opts.parentTaskId ?? null,
        depth,
        createdById: ctx.actor.id ?? organizationId,
      },
      select: summaryFields,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "agent.task.created",
      resourceType: "agent_task",
      resourceId: t.id,
      newValue: { profile: t.profile, title: t.title, companyId, aiEmployeeId: t.aiEmployeeId, parentTaskId: t.parentTaskId },
    });
    return t;
  });
  await enqueue(task.id, 1);
  return task;
}

export async function listTasks(ctx: RequestContext, organizationId: string, companyId: string, rawPage: Partial<PageInput> & Record<string, unknown> = {}) {
  const page = pageInput.parse(rawPage);
  const f = taskFilters.parse(rawPage);
  await authorize(ctx, organizationId, companyId, "agents.read");
  const rows = await db().agentTask.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.aiEmployeeId ? { aiEmployeeId: f.aiEmployeeId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.profile ? { profile: f.profile } : {}),
      ...(f.subjectType ? { subjectType: f.subjectType } : {}),
      ...(f.parentTaskId ? { parentTaskId: f.parentTaskId } : {}),
      ...(f.q ? { title: { contains: f.q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { id: "desc" },
    select: summaryFields,
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

/** Tasks a task delegated (direct children), oldest first. */
export async function listChildTasks(ctx: RequestContext, organizationId: string, companyId: string, parentTaskId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().agentTask.findMany({ where: { organizationId, companyId, parentTaskId }, orderBy: { createdAt: "asc" }, select: summaryFields });
}

/** AI tasks attached to one module record (newest first). */
export async function listSubjectTasks(ctx: RequestContext, organizationId: string, companyId: string, subjectType: string, subjectId: string, take = 10) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().agentTask.findMany({ where: { organizationId, companyId, subjectType, subjectId }, orderBy: { createdAt: "desc" }, take, select: { ...summaryFields, output: true } });
}

export async function getTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  if (!isUuid(taskId)) throw notFound("Task");
  const task = await db().agentTask.findFirst({
    where: { id: taskId, organizationId, companyId },
    omit: { runToken: true, organizationId: true },
  });
  if (!task) throw notFound("Task");
  return task;
}

export async function cancelTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    if (!isUuid(taskId)) throw notFound("Task");
    const task = await tx.agentTask.findFirst({ where: { id: taskId, organizationId, companyId }, select: { id: true, status: true } });
    if (!task) throw notFound("Task");
    // A running execution notices the cancellation before its next model call and never overwrites it.
    const { count } = await tx.agentTask.updateMany({ where: { id: taskId, status: { in: [...ACTIVE] } }, data: { status: "CANCELLED", completedAt: new Date(), runToken: null } });
    if (!count) throw conflict("Only queued or running tasks can be cancelled", { reason: "task_not_active" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "agent.task.cancelled", resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status } });
    return { ok: true };
  });
}

/** Re-run a FAILED or CANCELLED task as a new execution (new job id); the previous result is cleared. */
export async function retryTask(ctx: RequestContext, organizationId: string, companyId: string, taskId: string) {
  await authorize(ctx, organizationId, companyId, "agents.run");
  requireProvider();
  await requireBudget(organizationId, companyId);
  const attempts = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    if (!isUuid(taskId)) throw notFound("Task");
    const task = await tx.agentTask.findFirst({ where: { id: taskId, organizationId, companyId }, select: { status: true, attempts: true } });
    if (!task) throw notFound("Task");
    const { count } = await tx.agentTask.updateMany({
      where: { id: taskId, status: { in: ["FAILED", "CANCELLED"] } },
      data: { status: "QUEUED", runToken: null, output: null, citations: [], toolCalls: [], errorCode: null, errorMessage: null, startedAt: null, completedAt: null },
    });
    if (!count) throw conflict("Only failed or cancelled tasks can be retried", { reason: "task_not_retryable" });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "agent.task.retried", resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status } });
    return task.attempts;
  });
  await enqueue(taskId, attempts + 1);
  return getTask(ctx, organizationId, companyId, taskId);
}

/**
 * Worker entrypoint for one job. The claim (QUEUED → RUNNING with this job's token, or a re-delivery of the same job)
 * guarantees one execution per job; results are written only while the claim still holds, so a cancellation or a
 * newer execution is never overwritten. Retryable failures are rethrown for the queue to retry unless this is the
 * final attempt.
 */
export async function processAgentTask(taskId: string, jobId: string, opts: { finalAttempt: boolean }): Promise<"completed" | "failed" | "skipped"> {
  const claimed = await db().agentTask.updateMany({
    where: { id: taskId, OR: [{ status: "QUEUED" }, { status: "RUNNING", runToken: jobId }] },
    data: { status: "RUNNING", runToken: jobId, attempts: { increment: 1 }, startedAt: new Date() },
  });
  if (!claimed.count) return "skipped";
  const held = { id: taskId, status: "RUNNING" as const, runToken: jobId };

  const task = await db().agentTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      company: true,
      aiEmployee: { include: { memories: { orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: MEMORY_IN_PROMPT, select: { content: true } } } },
    },
  });
  const requester = userContext(task.createdById, { requestId: `task_${taskId}` });
  const employee = task.aiEmployee;
  // An AI employee may act as a configured member; tools then run with that member's permissions.
  const ctx = employee?.runsAsUserId ? userContext(employee.runsAsUserId, { requestId: `task_${taskId}` }) : requester;
  const log = logger.child({ component: "agent-task", taskId, jobId });
  const eventData = { profile: task.profile, title: task.title, aiEmployeeId: task.aiEmployeeId, parentTaskId: task.parentTaskId, subjectType: task.subjectType, subjectId: task.subjectId };

  try {
    // Platform AI controls may have changed since the task was queued (kill switch, disabled role/model, budgets).
    const refusal = await aiRefusal(task.organizationId, { profile: task.profile, model: await agentModel(env().AGENT_MODEL) });
    if (refusal) throw new TaskError(refusal, aiRefusalMessage(refusal));
    if (await isOrganizationSuspended(task.organizationId)) throw new TaskError("organization_suspended", "This organization is suspended by the platform");
    // The requester must still be allowed to run tasks in this company when the task executes.
    await authorize(requester, task.organizationId, task.companyId, "agents.run");
    if ((await aiUsageToday(task.organizationId, task.companyId)).exhausted) {
      throw new TaskError("budget_exhausted", "Today's AI allowance for this company is used up; retry tomorrow");
    }
    const profile = profileByKey(task.profile);
    if (!profile) throw new TaskError("unknown_profile", "This AI employee profile no longer exists");
    let tools: readonly string[] = profile.tools;
    let tokenCeiling: number | null = null;
    if (employee) {
      if (employee.archivedAt) throw new TaskError("employee_archived", "This AI employee was removed");
      if (employee.status === "PAUSED") throw new TaskError("employee_paused", `${employee.name} is paused; resume and retry`);
      // Budgets may have been spent since the task was queued; the remainder caps this run (runtime stops at it).
      const budget = await employeeBudget(task.organizationId, task.companyId, employee);
      const refusal = budgetRefusal(employee.name, budget);
      if (refusal) throw new TaskError(refusal.code, refusal.message);
      tokenCeiling = budget.remainingTokens;
      const allowed = employee.allowedTools.length ? profile.tools.filter((t) => employee.allowedTools.includes(t)) : profile.tools;
      await loadTools();
      tools = toolsForAutonomy(allowed, employee.autonomy);
      if (ctx !== requester) {
        // Never more than the requester could do: offer only tools whose permissions the requester also holds.
        const chain = await companyChain(db(), task.organizationId, task.companyId);
        const keep: string[] = [];
        for (const name of tools) {
          const def = getTool(name);
          if (def && (await Promise.all(def.permissions.map((p) => can(requester, p, chain)))).every(Boolean)) keep.push(name);
        }
        tools = keep;
      }
    }
    const result = await runTask({
      ctx,
      organizationId: task.organizationId,
      companyId: task.companyId,
      company: task.company,
      profile,
      title: task.title,
      instructions: task.instructions,
      taskId: task.id,
      isCancelled: async () => !(await db().agentTask.count({ where: held })),
      tools,
      tokenCeiling,
      employee: employee
        ? {
            name: employee.name,
            instructions: employee.instructions,
            skills: employee.skills,
            autonomyGuidance: AUTONOMY_GUIDANCE[employee.autonomy],
            memory: employee.memories.map((m) => m.content),
          }
        : null,
    });
    const remembered = employee ? [...result.output.matchAll(REMEMBER_LINE)].map((m) => m[1]!.trim().slice(0, 1000)).filter(Boolean).slice(0, 3) : [];
    const output = employee ? result.output.replace(REMEMBER_LINE, "").trim() || result.output : result.output;
    const stored = await transaction(async (tx) => {
      const { count } = await tx.agentTask.updateMany({
        where: held,
        data: {
          status: "COMPLETED",
          output,
          citations: result.citations as unknown as Prisma.InputJsonValue,
          toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          completedAt: new Date(),
          runToken: null,
        },
      });
      if (count) {
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: task.organizationId, action: "agent.task.completed", resourceType: "agent_task", resourceId: taskId, newValue: { model: result.model, citations: result.citations.length, companyId: task.companyId } });
        if (employee && remembered.length) {
          await tx.aiEmployeeMemory.createMany({
            data: remembered.map((content) => ({ organizationId: task.organizationId, companyId: task.companyId, aiEmployeeId: employee.id, content, source: "TASK" as const, sourceTaskId: taskId })),
          });
        }
        await emitDomainEvent(tx, ctx, "agent.task.completed", {
          organizationId: task.organizationId,
          companyId: task.companyId,
          entityType: "agent_task",
          entityId: taskId,
          data: { ...eventData, status: "COMPLETED", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        });
      }
      return count > 0;
    });
    // Not stored when the task was cancelled (or re-queued) while the model was working.
    log.info({ inputTokens: result.inputTokens, outputTokens: result.outputTokens, stored }, "agent task finished");
    return stored ? "completed" : "skipped";
  } catch (err) {
    const failure =
      err instanceof TaskError
        ? err
        : isAppError(err) && (err.code === "forbidden" || err.code === "not_found")
          ? new TaskError("permission_denied", "The requester can no longer run tasks in this company")
          : new TaskError("internal_error", "Execution failed unexpectedly", true);
    if (failure.code === "cancelled") return "skipped";
    if (failure.retryable && !opts.finalAttempt) {
      log.warn({ code: failure.code, err: err instanceof Error ? err.message : String(err) }, "agent task attempt failed; will retry");
      throw err;
    }
    log.error({ code: failure.code, err: err instanceof Error ? err.message : String(err) }, "agent task failed");
    await transaction(async (tx) => {
      // Tokens a failed run already spent are recorded too, so budgets and cost reports never hide them.
      const spent = failure.usage ? { model: failure.usage.model, inputTokens: failure.usage.inputTokens, outputTokens: failure.usage.outputTokens } : {};
      const { count } = await tx.agentTask.updateMany({ where: held, data: { status: "FAILED", errorCode: failure.code, errorMessage: failure.message, completedAt: new Date(), runToken: null, ...spent } });
      if (count) {
        await emitDomainEvent(tx, ctx, "agent.task.failed", {
          organizationId: task.organizationId,
          companyId: task.companyId,
          entityType: "agent_task",
          entityId: taskId,
          data: { ...eventData, status: "FAILED", errorCode: failure.code },
        });
      }
    });
    return "failed";
  }
}

/**
 * Fail tasks whose execution was lost (worker or Redis loss): RUNNING past the time limit, or QUEUED and never picked
 * up. They become retryable instead of looking busy forever.
 */
export async function failStaleTasks(runningMs = 30 * 60_000, queuedMs = 6 * 60 * 60_000): Promise<number> {
  const now = Date.now();
  const [running, queued] = await Promise.all([
    db().agentTask.updateMany({
      where: { status: "RUNNING", startedAt: { lt: new Date(now - runningMs) } },
      data: { status: "FAILED", errorCode: "interrupted", errorMessage: "Execution was interrupted; retry the task", completedAt: new Date(), runToken: null },
    }),
    db().agentTask.updateMany({
      where: { status: "QUEUED", updatedAt: { lt: new Date(now - queuedMs) } },
      data: { status: "FAILED", errorCode: "not_started", errorMessage: "The task was never picked up; check that the worker is running, then retry", completedAt: new Date() },
    }),
  ]);
  return running.count + queued.count;
}
