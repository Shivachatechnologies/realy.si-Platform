import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { enqueueAgentTask } from "@/server/core/jobs";
import { cancelTask } from "@/server/modules/agents/service";
import { decideApproval } from "@/server/modules/approvals/service";
import { writeAudit } from "@/server/modules/audit/service";
import { capabilitiesFor, isUuid, reasonSchema, requireAnyPlatform, requireConfirmation, requirePlatform } from "./access";
import { searchTasks } from "./ai";

/**
 * AI tasks control center (stream C): task detail and the platform task actions beyond cancel / retry (ai.ts).
 *
 * Task content (instructions, output, tool inputs, citations) is tenant data: it is shown only to holders of
 * `platform.data.read`; everyone with AI read access sees the metadata (status, timings, steps, tools used, costs,
 * request log, approvals, audit).
 *
 * Pause (`AgentTaskStatus.PAUSED`): a QUEUED, RUNNING or WAITING_APPROVAL task is parked by a platform admin. The
 * worker only claims QUEUED tasks, so a queued job finds it paused and skips; a running execution notices at its next
 * model call (its claim no longer holds) and stops without writing a result. Resume re-queues it as a new execution
 * (a parked approval conversation continues where it stopped; an interrupted run restarts its current attempt).
 */

const AI_READ = ["platform.ai.read", "platform.ai.manage"];
const PAUSABLE = ["QUEUED", "RUNNING", "WAITING_APPROVAL"] as const;

interface PauseState {
  pausedFrom?: string;
  pausedAt?: string;
  pausedBy?: string | null;
}
const jsonObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Everything about one task for the detail page. */
export async function getAdminTask(ctx: RequestContext, taskId: string) {
  await requireAnyPlatform(ctx, AI_READ);
  if (!isUuid(taskId)) throw notFound("Task");
  const task = await db().agentTask.findUnique({ where: { id: taskId }, include: { company: { select: { id: true, name: true } }, aiEmployee: { select: { id: true, name: true, profileKey: true, status: true } } } });
  if (!task) throw notFound("Task");
  const caps = await capabilitiesFor(ctx, ["platform.data.read", "platform.ai.manage"]);
  const sensitive = caps["platform.data.read"];
  const [org, parent, children, approvals, ledger, requests, audit, summaries, scheduleRun, requester, candidates] = await Promise.all([
    db().organization.findUnique({ where: { id: task.organizationId }, select: { id: true, name: true, status: true } }),
    task.parentTaskId ? db().agentTask.findUnique({ where: { id: task.parentTaskId }, select: { id: true, title: true, status: true } }) : null,
    db().agentTask.findMany({ where: { parentTaskId: task.id }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, title: true, status: true, profile: true, createdAt: true, completedAt: true, errorCode: true, inputTokens: true, outputTokens: true } }),
    db().approval.findMany({ where: { taskId: task.id, companyId: task.companyId }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, tool: true, summary: true, risk: true, status: true, createdAt: true, decidedAt: true, executedAt: true, error: true, expiresAt: true } }),
    db().costLedgerEntry.findMany({ where: { companyId: task.companyId, taskId: task.id }, orderBy: { occurredAt: "asc" }, take: 200, select: { id: true, occurredAt: true, provider: true, model: true, operation: true, inputTokens: true, outputTokens: true, cachedTokens: true, cacheWriteTokens: true, costMicros: true, sourceId: true, meta: true } }),
    db().aiRequestLog.findMany({ where: { taskId: task.id }, orderBy: { id: "asc" }, take: 200, select: { id: true, createdAt: true, provider: true, requestedModel: true, servedModel: true, status: true, errorCode: true, latencyMs: true, inputTokens: true, outputTokens: true, costMicros: true, attempt: true, traceId: true, tier: true } }),
    db().auditLog.findMany({ where: { resourceType: "agent_task", resourceId: task.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, category: true, action: true, actorType: true, actorId: true, reason: true, createdAt: true, oldValue: true, newValue: true } }),
    db().agentContextSummary.count({ where: { companyId: task.companyId, taskId: task.id } }),
    db().aiScheduleRun.findFirst({ where: { taskId: task.id }, select: { scheduleId: true, slot: true } }),
    db().user.findUnique({ where: { id: task.createdById }, select: { id: true, email: true, name: true } }),
    db().aiEmployee.findMany({ where: { companyId: task.companyId, archivedAt: null, status: "ACTIVE", ...(task.aiEmployeeId ? { NOT: { id: task.aiEmployeeId } } : {}) }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, profileKey: true } }),
  ]);
  const actorIds = [...new Set(audit.map((a) => a.actorId).filter((v): v is string => !!v))];
  const actors = actorIds.length ? await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, name: true } }) : [];
  const resume = jsonObject(task.resumeState);
  const toolCalls = (Array.isArray(task.toolCalls) ? task.toolCalls : []) as { tool?: string; input?: unknown; results?: number; error?: string; approvalId?: string; autonomousActionId?: string }[];
  const citations = Array.isArray(task.citations) ? task.citations : [];
  const costMicros = ledger.reduce((a, l) => a + Number(l.costMicros), 0);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    profile: task.profile,
    model: task.model,
    attempts: task.attempts,
    depth: task.depth,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
    inputTokens: task.inputTokens,
    outputTokens: task.outputTokens,
    subject: task.subjectType ? { type: task.subjectType, id: task.subjectId } : null,
    organization: org ?? { id: task.organizationId, name: task.organizationId.slice(0, 8), status: "ACTIVE" as const },
    company: task.company,
    employee: task.aiEmployee,
    requester: sensitive ? requester : requester ? { id: requester.id, email: null, name: requester.name } : null,
    parent,
    children,
    approvals,
    scheduleRun,
    contextSummaries: summaries,
    park: { parkOnApproval: !!resume.parkOnApproval, parks: typeof resume.parks === "number" ? resume.parks : 0, waitingFor: Array.isArray((resume.parked as Record<string, unknown> | undefined)?.waitingFor) ? ((resume.parked as { waitingFor: string[] }).waitingFor ?? []) : [] },
    pause: { pausedFrom: typeof resume.pausedFrom === "string" ? resume.pausedFrom : null, pausedAt: typeof resume.pausedAt === "string" ? resume.pausedAt : null },
    sensitive,
    content: sensitive
      ? { instructions: task.instructions, output: task.output, citations, toolCalls }
      : { instructions: null, output: null, citations: [], toolCalls: toolCalls.map((c) => ({ tool: c.tool, results: c.results, error: c.error ? "hidden" : undefined, approvalId: c.approvalId, autonomousActionId: c.autonomousActionId })), lengths: { instructions: task.instructions.length, output: task.output?.length ?? 0, citations: citations.length } },
    ledger: ledger.map((l) => ({ ...l, costMicros: Number(l.costMicros) })),
    requests: requests.map((r) => ({ ...r, costMicros: Number(r.costMicros) })),
    costMicros,
    audit: audit.map((a) => ({ ...a, actor: actors.find((u) => u.id === a.actorId) ?? null })),
    reassignCandidates: candidates,
    canManage: caps["platform.ai.manage"],
  };
}

export const pauseInput = z.object({ reason: reasonSchema });

/** Pause a queued, running or parked task (platform.ai.manage), audited. */
export async function pauseTask(ctx: RequestContext, taskId: string, raw: z.input<typeof pauseInput>) {
  const { reason } = pauseInput.parse(raw);
  if (!isUuid(taskId)) throw notFound("Task");
  return transaction(async (tx) => {
    await requirePlatform(ctx, "platform.ai.manage");
    const task = await tx.agentTask.findUnique({ where: { id: taskId }, select: { id: true, organizationId: true, status: true, resumeState: true } });
    if (!task) throw notFound("Task");
    if (!(PAUSABLE as readonly string[]).includes(task.status)) throw conflict("Only queued, running or approval-waiting tasks can be paused", { reason: "task_not_pausable" });
    const state: PauseState = { pausedFrom: task.status, pausedAt: new Date().toISOString(), pausedBy: ctx.actor.id };
    const { count } = await tx.agentTask.updateMany({ where: { id: taskId, status: task.status }, data: { status: "PAUSED", runToken: null, resumeState: { ...jsonObject(task.resumeState), ...state } as Prisma.InputJsonValue } });
    if (!count) throw conflict("The task changed meanwhile; reload and try again", { reason: "task_changed" });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: task.organizationId, action: "platform.ai.task_paused", resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status }, newValue: { status: "PAUSED" }, reason });
    return { ok: true, status: "PAUSED" as const };
  });
}

/** Resume a paused task: back to approval waiting (re-checked) or queued as a new execution. */
export async function resumeTask(ctx: RequestContext, taskId: string, raw: z.input<typeof pauseInput>) {
  const { reason } = pauseInput.parse(raw);
  if (!isUuid(taskId)) throw notFound("Task");
  const out = await transaction(async (tx) => {
    await requirePlatform(ctx, "platform.ai.manage");
    const task = await tx.agentTask.findUnique({ where: { id: taskId }, select: { id: true, organizationId: true, status: true, resumeState: true, attempts: true } });
    if (!task) throw notFound("Task");
    if (task.status !== "PAUSED") throw conflict("Only paused tasks can be resumed", { reason: "task_not_paused" });
    const rs = jsonObject(task.resumeState);
    const back = rs.pausedFrom === "WAITING_APPROVAL" && rs.parked ? "WAITING_APPROVAL" : "QUEUED";
    const { pausedFrom: _f, pausedAt: _a, pausedBy: _b, ...rest } = rs;
    void _f;
    void _a;
    void _b;
    const { count } = await tx.agentTask.updateMany({ where: { id: taskId, status: "PAUSED" }, data: { status: back, runToken: null, resumeState: Object.keys(rest).length ? (rest as Prisma.InputJsonValue) : undefined } });
    if (!count) throw conflict("The task changed meanwhile; reload and try again", { reason: "task_changed" });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: task.organizationId, action: "platform.ai.task_resumed", resourceType: "agent_task", resourceId: taskId, oldValue: { status: "PAUSED" }, newValue: { status: back }, reason });
    return { back, attempts: task.attempts };
  });
  if (out.back === "QUEUED") {
    try {
      // A fresh job id: the paused task's earlier job may still be retained by the queue under its old id.
      await enqueueAgentTask(taskId, `${taskId}_r${Date.now().toString(36)}`);
    } catch (err) {
      await db().agentTask.updateMany({ where: { id: taskId, status: "QUEUED" }, data: { status: "FAILED", errorCode: "queue_unavailable", errorMessage: "The task queue is unavailable; retry shortly", completedAt: new Date() } });
      throw err;
    }
  } else {
    const { resumeParkedTask } = await import("@/server/modules/agents/service");
    await resumeParkedTask(taskId).catch(() => false);
  }
  return { ok: true, status: out.back };
}

/** Cancel any active or paused task (paused tasks are not active for the tenant cancel path). */
export async function adminCancelTask(ctx: RequestContext, taskId: string, raw: z.input<typeof pauseInput>) {
  const { reason } = pauseInput.parse(raw);
  await requirePlatform(ctx, "platform.ai.manage");
  if (!isUuid(taskId)) throw notFound("Task");
  const task = await db().agentTask.findUnique({ where: { id: taskId }, select: { organizationId: true, companyId: true, status: true } });
  if (!task) throw notFound("Task");
  if (task.status === "PAUSED") {
    const { count } = await db().agentTask.updateMany({ where: { id: taskId, status: "PAUSED" }, data: { status: "CANCELLED", completedAt: new Date(), runToken: null } });
    if (!count) throw conflict("The task changed meanwhile; reload and try again", { reason: "task_changed" });
  } else {
    await cancelTask(systemContext(ctx.requestId), task.organizationId, task.companyId, taskId);
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: task.organizationId, action: "platform.ai.task_cancelled", resourceType: "agent_task", resourceId: taskId, oldValue: { status: task.status }, reason }));
  return { ok: true };
}

export const reassignInput = z.object({ aiEmployeeId: z.string().uuid(), reason: reasonSchema });

/** Move a not-yet-finished (or failed / cancelled) task to another active AI employee of the same company. */
export async function reassignTask(ctx: RequestContext, taskId: string, raw: z.input<typeof reassignInput>) {
  const input = reassignInput.parse(raw);
  if (!isUuid(taskId)) throw notFound("Task");
  return transaction(async (tx) => {
    await requirePlatform(ctx, "platform.ai.manage");
    const task = await tx.agentTask.findUnique({ where: { id: taskId }, select: { id: true, organizationId: true, companyId: true, status: true, aiEmployeeId: true, profile: true } });
    if (!task) throw notFound("Task");
    if (!["QUEUED", "PAUSED", "FAILED", "CANCELLED"].includes(task.status)) throw conflict("Pause the task first: only queued, paused, failed or cancelled tasks can be reassigned", { reason: "task_not_reassignable" });
    const emp = await tx.aiEmployee.findFirst({ where: { id: input.aiEmployeeId, companyId: task.companyId, archivedAt: null }, select: { id: true, profileKey: true, status: true, name: true } });
    if (!emp) throw notFound("AI employee");
    if (emp.status !== "ACTIVE") throw conflict(`${emp.name} is paused; resume it first`, { reason: "employee_paused" });
    const { count } = await tx.agentTask.updateMany({ where: { id: taskId, status: task.status }, data: { aiEmployeeId: emp.id, profile: emp.profileKey } });
    if (!count) throw conflict("The task changed meanwhile; reload and try again", { reason: "task_changed" });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: task.organizationId, action: "platform.ai.task_reassigned", resourceType: "agent_task", resourceId: taskId, oldValue: { aiEmployeeId: task.aiEmployeeId, profile: task.profile }, newValue: { aiEmployeeId: emp.id, profile: emp.profileKey }, reason: input.reason });
    return { ok: true };
  });
}

export const rejectApprovalInput = z.object({ reason: reasonSchema, confirm: z.string().optional() });

/**
 * Platform override: reject one PENDING approval request of a task (the action never runs; the parked task resumes
 * with the rejection). Approving on a tenant's behalf is deliberately not offered: an approval executes the action in
 * the tenant's accounts, which is a tenant decision. Typed confirmation, reason and audit (ADMIN) required.
 */
export async function adminRejectApproval(ctx: RequestContext, approvalId: string, raw: z.input<typeof rejectApprovalInput>) {
  const input = rejectApprovalInput.parse(raw);
  await requirePlatform(ctx, "platform.ai.manage");
  if (!isUuid(approvalId)) throw notFound("Approval");
  const a = await db().approval.findUnique({ where: { id: approvalId }, select: { id: true, organizationId: true, companyId: true, status: true, tool: true, taskId: true } });
  if (!a) throw notFound("Approval");
  requireConfirmation(input.confirm, "REJECT");
  await decideApproval(systemContext(ctx.requestId), a.organizationId, a.companyId, a.id, { decision: "reject", note: `Rejected by the platform: ${input.reason}` });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: a.organizationId, action: "platform.ai.approval_rejected", resourceType: "approval", resourceId: a.id, oldValue: { status: a.status }, newValue: { status: "REJECTED", tool: a.tool, taskId: a.taskId }, reason: input.reason }));
  return { ok: true };
}

/** Export one task's execution log as JSON (content only with platform.data.read). Audited. */
export async function exportTaskLog(ctx: RequestContext, taskId: string) {
  await requireAnyPlatform(ctx, ["platform.ai.manage", "platform.data.export"]);
  const detail = await getAdminTask(ctx, taskId);
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", organizationId: detail.organization.id, action: "platform.ai.task_log_exported", resourceType: "agent_task", resourceId: taskId, newValue: { content: detail.sensitive } }));
  const { reassignCandidates: _c, canManage: _m, ...rest } = detail;
  void _c;
  void _m;
  return { filename: `ai-task-${taskId}.json`, json: JSON.stringify(rest, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) };
}

/** CSV of the task list for the current filters (max 5 000 rows, metadata only). Audited. */
export async function exportTasksCsv(ctx: RequestContext, raw: Record<string, unknown>) {
  await requireAnyPlatform(ctx, ["platform.ai.manage", "platform.data.export"]);
  const head = ["id", "created_at", "organization_id", "company", "profile", "title", "status", "model", "input_tokens", "output_tokens", "attempts", "error_code", "started_at", "completed_at"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 25 && lines.length < 5_000; i++) {
    const page = await searchTasks(ctx, { ...raw, limit: 200, cursor });
    for (const t of page.data) lines.push([t.id, t.createdAt, t.organizationId, t.company.name, t.profile, t.title, t.status, t.model, t.inputTokens, t.outputTokens, t.attempts, t.errorCode, t.startedAt, t.completedAt].map(esc).join(","));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.ai.tasks_exported", resourceType: "agent_task", newValue: { filters: raw, rows: lines.length } }));
  return { filename: `ai-tasks-${new Date().toISOString().slice(0, 10)}.csv`, csv: [head.join(","), ...lines].join("\n") + "\n", rows: lines.length };
}
