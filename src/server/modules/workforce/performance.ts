import { db } from "@/server/core/db";
import { costMicros } from "./pricing";

/**
 * Performance scorecards computed from real AgentTask, Approval and AiEmployeeReport rows (no estimates beyond the
 * token price table): success rate, turnaround, run time, cost, delegation and escalation activity per AI employee
 * and per department over a trailing window. Callers must have checked agents.read.
 */
export interface Scorecard {
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  /** completed / (completed + failed); null without finished work. */
  successRate: number | null;
  /** Median minutes from assignment (created) to finished. */
  medianTurnaroundMs: number | null;
  /** Average model time (started → finished) of completed tasks. */
  avgRunMs: number | null;
  tokens: number;
  costMicros: number;
  /** Cost per completed task. */
  costPerCompletedMicros: number | null;
  /** Sub-tasks this employee's tasks delegated. */
  delegated: number;
  escalationsFiled: number;
  escalationsOpen: number;
  approvalsRequested: number;
  approvalsApproved: number;
}

const empty = (): Scorecard => ({
  completed: 0,
  failed: 0,
  cancelled: 0,
  active: 0,
  successRate: null,
  medianTurnaroundMs: null,
  avgRunMs: null,
  tokens: 0,
  costMicros: 0,
  costPerCompletedMicros: null,
  delegated: 0,
  escalationsFiled: 0,
  escalationsOpen: 0,
  approvalsRequested: 0,
  approvalsApproved: 0,
});

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface WorkforcePerformance {
  days: number;
  byEmployee: Map<string, Scorecard>;
  byDepartment: Map<string, Scorecard & { employees: number }>;
  total: Scorecard;
}

/** Scorecards for the given employees over the last `days` days. */
export async function workforcePerformance(
  organizationId: string,
  companyId: string,
  employees: { id: string; department: string }[],
  days = 30,
): Promise<WorkforcePerformance> {
  const since = new Date(Date.now() - days * 86_400_000);
  const ids = employees.map((e) => e.id);
  const byEmployee = new Map(ids.map((id) => [id, empty()]));
  const turn = new Map<string, number[]>();
  const runs = new Map<string, number[]>();
  if (ids.length) {
    const scope = { organizationId, companyId, aiEmployeeId: { in: ids } };
    const [tasks, active, children, reports, approvals] = await Promise.all([
      db().agentTask.findMany({
        where: { ...scope, OR: [{ completedAt: { gte: since } }, { startedAt: { gte: since } }] },
        select: { aiEmployeeId: true, status: true, createdAt: true, startedAt: true, completedAt: true, model: true, inputTokens: true, outputTokens: true },
        take: 20_000,
      }),
      db().agentTask.groupBy({ by: ["aiEmployeeId"], where: { ...scope, status: { in: ["QUEUED", "RUNNING"] } }, _count: { _all: true } }),
      db().agentTask.findMany({ where: { organizationId, companyId, createdAt: { gte: since }, parentTask: { aiEmployeeId: { in: ids } } }, select: { parentTask: { select: { aiEmployeeId: true } } }, take: 5000 }),
      db().aiEmployeeReport.findMany({ where: { organizationId, companyId, kind: "ESCALATION", aiEmployeeId: { in: ids }, OR: [{ createdAt: { gte: since } }, { resolvedAt: null }] }, select: { aiEmployeeId: true, createdAt: true, resolvedAt: true }, take: 5000 }),
      db().approval.findMany({ where: { organizationId, companyId, createdAt: { gte: since }, task: { aiEmployeeId: { in: ids } } }, select: { status: true, task: { select: { aiEmployeeId: true } } }, take: 10_000 }),
    ]);
    for (const t of tasks) {
      const s = byEmployee.get(t.aiEmployeeId!);
      if (!s) continue;
      if (t.startedAt && t.startedAt >= since) {
        s.tokens += (t.inputTokens ?? 0) + (t.outputTokens ?? 0);
        s.costMicros += costMicros(t.model, t.inputTokens ?? 0, t.outputTokens ?? 0);
      }
      if (!t.completedAt || t.completedAt < since) continue;
      if (t.status === "COMPLETED") {
        s.completed++;
        turn.set(t.aiEmployeeId!, [...(turn.get(t.aiEmployeeId!) ?? []), t.completedAt.getTime() - t.createdAt.getTime()]);
        if (t.startedAt) runs.set(t.aiEmployeeId!, [...(runs.get(t.aiEmployeeId!) ?? []), t.completedAt.getTime() - t.startedAt.getTime()]);
      } else if (t.status === "FAILED") s.failed++;
      else if (t.status === "CANCELLED") s.cancelled++;
    }
    for (const a of active) {
      const s = byEmployee.get(a.aiEmployeeId!);
      if (s) s.active = a._count._all;
    }
    for (const c of children) {
      const s = byEmployee.get(c.parentTask?.aiEmployeeId ?? "");
      if (s) s.delegated++;
    }
    for (const r of reports) {
      const s = byEmployee.get(r.aiEmployeeId);
      if (!s) continue;
      if (r.createdAt >= since) s.escalationsFiled++;
      if (!r.resolvedAt) s.escalationsOpen++;
    }
    for (const a of approvals) {
      const s = byEmployee.get(a.task?.aiEmployeeId ?? "");
      if (!s) continue;
      s.approvalsRequested++;
      if (a.status === "APPROVED" || a.status === "EXECUTED") s.approvalsApproved++;
    }
  }

  const finish = (s: Scorecard, turnaround: number[], run: number[]) => {
    s.successRate = s.completed + s.failed ? s.completed / (s.completed + s.failed) : null;
    s.medianTurnaroundMs = median(turnaround);
    s.avgRunMs = run.length ? run.reduce((a, b) => a + b, 0) / run.length : null;
    s.costPerCompletedMicros = s.completed ? s.costMicros / s.completed : null;
  };
  const add = (into: Scorecard, s: Scorecard) => {
    for (const k of ["completed", "failed", "cancelled", "active", "tokens", "costMicros", "delegated", "escalationsFiled", "escalationsOpen", "approvalsRequested", "approvalsApproved"] as const) into[k] += s[k];
  };

  const byDepartment = new Map<string, Scorecard & { employees: number }>();
  const deptTurn = new Map<string, number[]>();
  const deptRun = new Map<string, number[]>();
  const total = empty();
  for (const e of employees) {
    const s = byEmployee.get(e.id)!;
    finish(s, turn.get(e.id) ?? [], runs.get(e.id) ?? []);
    const d = byDepartment.get(e.department) ?? { ...empty(), employees: 0 };
    d.employees++;
    add(d, s);
    byDepartment.set(e.department, d);
    deptTurn.set(e.department, [...(deptTurn.get(e.department) ?? []), ...(turn.get(e.id) ?? [])]);
    deptRun.set(e.department, [...(deptRun.get(e.department) ?? []), ...(runs.get(e.id) ?? [])]);
    add(total, s);
  }
  for (const [k, d] of byDepartment) finish(d, deptTurn.get(k) ?? [], deptRun.get(k) ?? []);
  finish(total, [...turn.values()].flat(), [...runs.values()].flat());
  return { days, byEmployee, byDepartment, total };
}
