import { db } from "@/server/core/db";
import type { MetricDefinition } from "@/server/core/metrics";
import { costMicros } from "./pricing";

const inRange = (r: { from: Date; to: Date }) => ({ gte: r.from, lt: r.to });

/** KPIs of the AI workforce (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const WORKFORCE_METRICS: MetricDefinition[] = [
  {
    key: "workforce.ai_tasks_completed",
    labelKey: "workforce.metrics.aiTasksCompleted",
    department: "ai",
    unit: "count",
    permission: "agents.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/tasks?status=COMPLETED",
    compute: ({ organizationId, companyId }, r) => db().agentTask.count({ where: { organizationId, companyId, status: "COMPLETED", completedAt: inRange(r) } }),
  },
  {
    key: "workforce.ai_tasks_failed",
    labelKey: "workforce.metrics.aiTasksFailed",
    department: "ai",
    unit: "count",
    permission: "agents.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/tasks?status=FAILED",
    compute: ({ organizationId, companyId }, r) => db().agentTask.count({ where: { organizationId, companyId, status: "FAILED", completedAt: inRange(r) } }),
  },
  {
    key: "workforce.ai_tokens",
    labelKey: "workforce.metrics.aiTokens",
    department: "ai",
    unit: "count",
    permission: "agents.read",
    kind: "flow",
    href: "/workforce/usage",
    async compute({ organizationId, companyId }, r) {
      const s = await db().agentTask.aggregate({ where: { organizationId, companyId, startedAt: inRange(r) }, _sum: { inputTokens: true, outputTokens: true } });
      return (s._sum.inputTokens ?? 0) + (s._sum.outputTokens ?? 0);
    },
  },
  {
    // Estimated from tokens and the model price table, in US dollars (not converted to the company currency).
    key: "workforce.ai_cost_usd",
    labelKey: "workforce.metrics.aiCostUsd",
    department: "ai",
    unit: "count",
    permission: "agents.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/workforce/usage",
    async compute({ organizationId, companyId }, r) {
      const rows = await db().agentTask.groupBy({ by: ["model"], where: { organizationId, companyId, startedAt: inRange(r) }, _sum: { inputTokens: true, outputTokens: true } });
      const micros = rows.reduce((s, x) => s + costMicros(x.model, x._sum.inputTokens ?? 0, x._sum.outputTokens ?? 0), 0);
      return Math.round(micros / 10_000) / 100;
    },
  },
  {
    key: "workforce.approvals_pending",
    labelKey: "workforce.metrics.approvalsPending",
    department: "ai",
    unit: "count",
    permission: "approvals.read",
    kind: "stock",
    higherIsBetter: false,
    href: "/approvals",
    compute: ({ organizationId, companyId }, r) => {
      const at = new Date(Math.min(r.to.getTime(), Date.now()));
      return db().approval.count({
        where: { organizationId, companyId, createdAt: { lt: r.to }, expiresAt: { gt: at }, OR: [{ status: "PENDING" }, { decidedAt: { gte: at } }] },
      });
    },
  },
  {
    key: "workforce.ai_employees_active",
    labelKey: "workforce.metrics.aiEmployeesActive",
    department: "ai",
    unit: "count",
    permission: "agents.read",
    kind: "stock",
    href: "/workforce",
    compute: ({ organizationId, companyId }, r) => db().aiEmployee.count({ where: { organizationId, companyId, createdAt: { lt: r.to }, archivedAt: null, status: "ACTIVE" } }),
  },
];
