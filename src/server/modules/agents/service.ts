import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { userContext, type RequestContext } from "@/server/core/context";
import { AppError, conflict, isAppError, notFound } from "@/server/core/errors";
import { enqueueAgentTask } from "@/server/core/jobs";
import { logger } from "@/server/core/logger";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { PROFILE_KEYS, profileByKey } from "./profiles";
import { aiConfigured, runTask, TaskError } from "./runtime";

export const createTaskInput = z.object({
  profile: z.enum(PROFILE_KEYS),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(8000),
});

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const ACTIVE = ["QUEUED", "RUNNING"] as const;

/** Columns for lists: everything but the (potentially long) output and traces. */
const summaryFields = {
  id: true,
  companyId: true,
  profile: true,
  title: true,
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

export async function createTask(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createTaskInput>) {
  const input = createTaskInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.run");
  requireProvider();
  const task = await transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "agents.run", tx);
    const t = await tx.agentTask.create({
      data: { organizationId, companyId, profile: input.profile, title: input.title, instructions: input.instructions, createdById: ctx.actor.id ?? organizationId },
      select: summaryFields,
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "agent.task.created", resourceType: "agent_task", resourceId: t.id, newValue: { profile: t.profile, title: t.title } });
    return t;
  });
  await enqueue(task.id, 1);
  return task;
}

export async function listTasks(ctx: RequestContext, organizationId: string, companyId: string, rawPage: Partial<PageInput> = {}) {
  const page = pageInput.parse(rawPage);
  await authorize(ctx, organizationId, companyId, "agents.read");
  const rows = await db().agentTask.findMany({ where: { organizationId, companyId }, orderBy: { id: "desc" }, select: summaryFields, ...prismaPage(page) });
  return toPage(rows, page);
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

  const task = await db().agentTask.findUniqueOrThrow({ where: { id: taskId }, include: { company: true } });
  const ctx = userContext(task.createdById, { requestId: `task_${taskId}` });
  const log = logger.child({ component: "agent-task", taskId, jobId });

  try {
    // The requester must still be allowed to run tasks in this company when the task executes.
    await authorize(ctx, task.organizationId, task.companyId, "agents.run");
    const profile = profileByKey(task.profile);
    if (!profile) throw new TaskError("unknown_profile", "This AI employee profile no longer exists");
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
    });
    const stored = await transaction(async (tx) => {
      const { count } = await tx.agentTask.updateMany({
        where: held,
        data: {
          status: "COMPLETED",
          output: result.output,
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
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: task.organizationId, action: "agent.task.completed", resourceType: "agent_task", resourceId: taskId, newValue: { model: result.model, citations: result.citations.length } });
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
    await db().agentTask.updateMany({ where: held, data: { status: "FAILED", errorCode: failure.code, errorMessage: failure.message, completedAt: new Date(), runToken: null } });
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
