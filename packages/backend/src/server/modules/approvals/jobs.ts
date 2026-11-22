import type { ModuleJobs } from "@/server/core/module-jobs";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { writeAudit } from "@/server/modules/audit/service";
import { resumeParkedTask, sweepParkedTasks } from "@/server/modules/agents/service";
import { failInterruptedApprovals, runQueuedApproval } from "./service";

/**
 * Approved-action feedback (G1, B3 + B27). When an approval is resolved (executed, failed or rejected):
 *  - a task parked on it (WAITING_APPROVAL) resumes with the outcome once all its requests are decided;
 *  - a finished task's trace records the outcome on the tool call that filed the request;
 *  - the AI Command run the task belongs to is annotated (audit) and advanced, so its stages show the outcome.
 * At-least-once delivery is safe: every step is idempotent (conditional claims, overwrite of the same fields).
 */

const TERMINAL_TASK = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export async function handleApprovalResolved(event: OutboxEvent): Promise<void> {
  if (event.aggregateType !== "approval" || !event.aggregateId || !event.companyId) return;
  const a = await db().approval.findFirst({ where: { id: event.aggregateId, companyId: event.companyId }, select: { id: true, organizationId: true, companyId: true, taskId: true, tool: true, status: true, error: true, result: true, commandRunId: true, attempts: true } });
  if (!a?.taskId) return;
  const task = await db().agentTask.findFirst({ where: { id: a.taskId, companyId: a.companyId }, select: { id: true, status: true, toolCalls: true } });
  if (!task) return;
  if (task.status === "WAITING_APPROVAL") {
    await resumeParkedTask(task.id);
  } else if (TERMINAL_TASK.has(task.status) && Array.isArray(task.toolCalls)) {
    const content = a.result && typeof a.result === "object" && "content" in (a.result as object) ? String((a.result as { content?: unknown }).content ?? "").slice(0, 500) : null;
    const calls = (task.toolCalls as Record<string, unknown>[]).map((c) => (c.approvalId === a.id ? { ...c, approvalStatus: a.status, ...(content ? { approvalResult: content } : {}), ...(a.error ? { approvalError: a.error } : {}) } : c));
    await db().agentTask.updateMany({ where: { id: task.id, status: task.status }, data: { toolCalls: calls as unknown as Prisma.InputJsonValue } });
  }
  if (a.commandRunId) {
    const run = await db().commandRun.findFirst({ where: { id: a.commandRunId, companyId: a.companyId }, select: { id: true } });
    if (run) {
      await transaction((tx) =>
        writeAudit(tx, systemContext(`approval_${a.id}`), { category: "TENANT", organizationId: a.organizationId, action: "guide.command.approval_outcome", resourceType: "command_run", resourceId: run.id, newValue: { companyId: a.companyId, approvalId: a.id, tool: a.tool, status: a.status, attempt: a.attempts } }),
      );
      // Lazy import: guide/command-run → agents/service → … would otherwise form a load-time cycle.
      const { advanceRunForTask } = await import("@/server/modules/guide/command-run");
      await advanceRunForTask(a.organizationId, a.companyId, task.id).catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err), approvalId: a.id }, "command run not advanced after approval"));
    }
  }
}

/** Registered through workforce/jobs.ts (G1-owned) so no shared worker registry changes. */
export const APPROVALS_JOBS: ModuleJobs = {
  periodic: [
    // Parked tasks: resume once every approval is decided (also after expiry, which emits no event); time out after 4 days.
    { name: "approvals.resume-parked", everyMs: 60_000, run: () => sweepParkedTasks() },
    // Approved actions whose execution was lost become FAILED (retryable).
    { name: "approvals.interrupted", everyMs: 5 * 60_000, run: () => failInterruptedApprovals() },
  ],
  onEvent: [{ name: "approvals.feedback", types: ["approval.resolved"], handle: handleApprovalResolved }],
  tasks: [{ name: "approvals.execute", attempts: 1, run: (data) => runQueuedApproval(data) }],
};
