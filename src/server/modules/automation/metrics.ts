import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

/** KPIs of the automation module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const AUTOMATION_METRICS: MetricDefinition[] = [
  {
    key: "automation.active_workflows",
    labelKey: "workflows.metrics.activeWorkflows",
    department: "operations",
    unit: "count",
    permission: "workflows.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/workflows?status=ACTIVE",
    compute: ({ organizationId, companyId }) => db().workflow.count({ where: { organizationId, companyId, status: "ACTIVE" } }),
  },
  {
    key: "automation.runs",
    labelKey: "workflows.metrics.runs",
    department: "operations",
    unit: "count",
    permission: "workflows.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/workflows/runs",
    compute: ({ organizationId, companyId }, { from, to }) => db().workflowRun.count({ where: { organizationId, companyId, isTest: false, createdAt: { gte: from, lt: to } } }),
  },
  {
    key: "automation.failed_runs",
    labelKey: "workflows.metrics.failedRuns",
    department: "operations",
    unit: "count",
    permission: "workflows.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/workflows/runs?status=FAILED",
    compute: ({ organizationId, companyId }, { from, to }) => db().workflowRun.count({ where: { organizationId, companyId, isTest: false, status: "FAILED", createdAt: { gte: from, lt: to } } }),
  },
  {
    key: "automation.success_rate",
    labelKey: "workflows.metrics.successRate",
    department: "operations",
    unit: "percent",
    permission: "workflows.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/workflows/runs",
    async compute({ organizationId, companyId }, { from, to }) {
      const where = { organizationId, companyId, isTest: false, createdAt: { gte: from, lt: to } };
      const [ok, failed] = await Promise.all([db().workflowRun.count({ where: { ...where, status: "SUCCEEDED" } }), db().workflowRun.count({ where: { ...where, status: "FAILED" } })]);
      return ok + failed ? Math.round((ok / (ok + failed)) * 1000) / 10 : 0;
    },
  },
];
