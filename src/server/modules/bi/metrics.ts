import { db } from "@/server/core/db";
import type { MetricDefinition } from "@/server/core/metrics";

/** Company-level KPIs from core records (objectives); used by analytics, dashboards and AI briefings. */
export const BI_METRICS: MetricDefinition[] = [
  {
    key: "bi.objectives_active",
    labelKey: "analytics.metrics.objectivesActive",
    department: "executive",
    unit: "count",
    permission: "objectives.read",
    kind: "stock",
    href: "/objectives",
    compute: ({ organizationId, companyId }, r) => db().objective.count({ where: { organizationId, companyId, status: "ACTIVE", createdAt: { lt: r.to } } }),
  },
  {
    key: "bi.milestones_completed",
    labelKey: "analytics.metrics.milestonesCompleted",
    department: "executive",
    unit: "count",
    permission: "objectives.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/objectives",
    compute: ({ organizationId, companyId }, r) => db().milestone.count({ where: { organizationId, companyId, completedAt: { gte: r.from, lt: r.to } } }),
  },
  {
    key: "bi.milestones_overdue",
    labelKey: "analytics.metrics.milestonesOverdue",
    department: "executive",
    unit: "count",
    permission: "objectives.read",
    kind: "stock",
    higherIsBetter: false,
    href: "/objectives",
    compute: ({ organizationId, companyId }, r) => {
      const at = new Date(Math.min(r.to.getTime(), Date.now()));
      return db().milestone.count({ where: { organizationId, companyId, dueDate: { lt: at }, OR: [{ completedAt: null }, { completedAt: { gte: at } }] } });
    },
  },
];
