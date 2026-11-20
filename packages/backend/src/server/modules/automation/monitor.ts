import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorizeWorkflows } from "./service";

/**
 * Workflow monitoring: real run history of the last 14 days aggregated per day and per workflow, health per workflow,
 * and the things that need a person (failed runs in the dead-letter list, approvals waiting too long, runs stuck).
 * Test runs are excluded. Nothing here is estimated: every number is a count of stored runs.
 */

export const MONITOR_DAYS = 14;
const STUCK_APPROVAL_MS = 48 * 3_600_000;
const STUCK_RUNNING_MS = 30 * 60_000;

export type Health = "healthy" | "degraded" | "failing" | "idle";

export interface MonitorWorkflow {
  id: string;
  name: string;
  status: string;
  runs: number;
  succeeded: number;
  failed: number;
  waiting: number;
  successRate: number | null;
  avgMs: number | null;
  lastRunAt: Date | null;
  lastFailure: { runId: string; at: Date; error: string | null } | null;
  /** Statuses of the most recent runs, newest first (max 10). */
  recent: string[];
  health: Health;
}

function healthOf(w: { runs: number; failed: number; successRate: number | null; recent: string[] }): Health {
  if (!w.runs) return "idle";
  const finished = w.recent.filter((s) => s === "SUCCEEDED" || s === "FAILED");
  if (finished.length >= 3 && finished.slice(0, 3).every((s) => s === "FAILED")) return "failing";
  if (w.successRate !== null && w.successRate < 70) return "failing";
  if (w.failed > 0 && w.successRate !== null && w.successRate < 95) return "degraded";
  return "healthy";
}

export async function monitorOverview(ctx: RequestContext, organizationId: string, companyId: string, now = new Date()) {
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.read");
  const dayMs = 86_400_000;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (MONITOR_DAYS - 1) * dayMs);
  const [workflows, runs, deadLetters, oldApprovals, stuck] = await Promise.all([
    db().workflow.findMany({ where: { organizationId, companyId, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, name: true, status: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db().workflowRun.findMany({
      where: { organizationId, companyId, isTest: false, createdAt: { gte: start } },
      select: { id: true, workflowId: true, status: true, createdAt: true, startedAt: true, finishedAt: true, error: true, waitingFor: true },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    }),
    db().workflowRun.findMany({
      where: { organizationId, companyId, deadLetteredAt: { not: null } },
      select: { id: true, error: true, deadLetteredAt: true, workflow: { select: { id: true, name: true } } },
      orderBy: { deadLetteredAt: "desc" },
      take: 8,
    }),
    db().workflowApprovalRequest.findMany({
      where: { organizationId, companyId, status: "PENDING", createdAt: { lt: new Date(now.getTime() - STUCK_APPROVAL_MS) } },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    }),
    db().workflowRun.findMany({
      where: { organizationId, companyId, status: "RUNNING", claimedAt: { lt: new Date(now.getTime() - STUCK_RUNNING_MS) } },
      select: { id: true, claimedAt: true, workflow: { select: { name: true } } },
      take: 8,
    }),
  ]);

  // Day series (UTC days, oldest first).
  const days = Array.from({ length: MONITOR_DAYS }, (_, i) => ({ date: new Date(start.getTime() + i * dayMs).toISOString().slice(0, 10), succeeded: 0, failed: 0, other: 0 }));
  for (const r of runs) {
    const i = Math.floor((r.createdAt.getTime() - start.getTime()) / dayMs);
    const d = days[i];
    if (!d) continue;
    if (r.status === "SUCCEEDED") d.succeeded++;
    else if (r.status === "FAILED") d.failed++;
    else d.other++;
  }

  const byWf = new Map<string, typeof runs>();
  for (const r of runs) byWf.set(r.workflowId, [...(byWf.get(r.workflowId) ?? []), r]);
  const rows: MonitorWorkflow[] = workflows.map((w) => {
    const list = byWf.get(w.id) ?? [];
    const succeeded = list.filter((r) => r.status === "SUCCEEDED").length;
    const failed = list.filter((r) => r.status === "FAILED").length;
    const durations = list.filter((r) => r.startedAt && r.finishedAt && r.status === "SUCCEEDED").map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime());
    const lastFail = list.find((r) => r.status === "FAILED");
    const row = {
      id: w.id,
      name: w.name,
      status: w.status,
      runs: list.length,
      succeeded,
      failed,
      waiting: list.filter((r) => r.status === "WAITING").length,
      successRate: succeeded + failed ? Math.round((succeeded / (succeeded + failed)) * 1000) / 10 : null,
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      lastRunAt: list[0]?.createdAt ?? null,
      lastFailure: lastFail ? { runId: lastFail.id, at: lastFail.finishedAt ?? lastFail.createdAt, error: lastFail.error } : null,
      recent: list.slice(0, 10).map((r) => r.status),
    };
    return { ...row, health: healthOf(row) };
  });
  const order: Record<Health, number> = { failing: 0, degraded: 1, healthy: 2, idle: 3 };
  rows.sort((a, b) => order[a.health] - order[b.health] || b.runs - a.runs);

  const totals = {
    runs: runs.length,
    succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
    failed: runs.filter((r) => r.status === "FAILED").length,
    waiting: runs.filter((r) => r.status === "WAITING").length,
    waitingApproval: runs.filter((r) => r.status === "WAITING" && r.waitingFor === "approval").length,
  };
  const finished = totals.succeeded + totals.failed;
  return {
    days,
    workflows: rows,
    totals: { ...totals, successRate: finished ? Math.round((totals.succeeded / finished) * 1000) / 10 : null, truncated: runs.length >= 10_000 },
    alerts: {
      deadLetters: deadLetters.map((d) => ({ runId: d.id, workflowId: d.workflow.id, workflowName: d.workflow.name, error: d.error, at: d.deadLetteredAt! })),
      oldApprovals: oldApprovals.map((a) => ({ id: a.id, title: a.title, since: a.createdAt })),
      stuck: stuck.map((s) => ({ runId: s.id, workflowName: s.workflow.name, since: s.claimedAt! })),
    },
  };
}
