import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

const OPEN = { notIn: ["DONE", "CANCELLED"] } as { notIn: ("DONE" | "CANCELLED")[] };
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** KPIs of the work module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const WORK_METRICS: MetricDefinition[] = [
  {
    key: "work.active_projects",
    labelKey: "work.metrics.activeProjects",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/projects?status=ACTIVE",
    compute: ({ organizationId, companyId }, { to }) =>
      db().project.count({ where: { organizationId, companyId, archivedAt: null, status: "ACTIVE", createdAt: { lt: to } } }),
  },
  {
    key: "work.tasks_completed",
    labelKey: "work.metrics.tasksCompleted",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/projects/tasks",
    compute: ({ organizationId, companyId }, { from, to }) =>
      db().workTask.count({ where: { organizationId, companyId, archivedAt: null, status: "DONE", completedAt: { gte: from, lt: to } } }),
  },
  {
    key: "work.overdue_tasks",
    labelKey: "work.metrics.overdueTasks",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "stock",
    higherIsBetter: false,
    href: "/projects/tasks?due=overdue",
    // Open at range end with a due date before it (tasks completed later count if they were still open then).
    compute: ({ organizationId, companyId }, { to }) =>
      db().workTask.count({
        where: {
          organizationId,
          companyId,
          archivedAt: null,
          createdAt: { lt: to },
          dueDate: { lt: dayOf(to) },
          OR: [{ status: OPEN }, { status: "DONE", completedAt: { gte: to } }],
        },
      }),
  },
  {
    key: "work.on_time_completion",
    labelKey: "work.metrics.onTimeCompletion",
    department: "projects",
    unit: "percent",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: true,
    compute: async ({ organizationId, companyId }, { from, to }) => {
      const done = await db().workTask.findMany({
        where: { organizationId, companyId, archivedAt: null, status: "DONE", completedAt: { gte: from, lt: to }, dueDate: { not: null } },
        select: { dueDate: true, completedAt: true },
        take: 20_000,
      });
      if (!done.length) return 0;
      const onTime = done.filter((t) => dayOf(t.completedAt!) <= t.dueDate!).length;
      return Math.round((onTime / done.length) * 1000) / 10;
    },
  },
  {
    key: "work.sprint_velocity",
    labelKey: "work.metrics.sprintVelocity",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: true,
    // Average points completed per sprint closed in the range.
    compute: async ({ organizationId, companyId }, { from, to }) => {
      const r = await db().sprint.aggregate({ where: { organizationId, companyId, status: "COMPLETED", completedAt: { gte: from, lt: to } }, _avg: { completedPoints: true } });
      return Math.round((r._avg.completedPoints ?? 0) * 10) / 10;
    },
  },
  {
    key: "work.open_risks",
    labelKey: "work.metrics.openRisks",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "stock",
    higherIsBetter: false,
    compute: ({ organizationId, companyId }, { to }) =>
      db().projectRisk.count({ where: { organizationId, companyId, status: { in: ["OPEN", "MITIGATING"] }, createdAt: { lt: to }, project: { archivedAt: null } } }),
  },
  {
    key: "work.open_incidents",
    labelKey: "work.metrics.openIncidents",
    department: "operations",
    unit: "count",
    permission: "operations.read",
    kind: "stock",
    higherIsBetter: false,
    href: "/operations/incidents?status=open",
    compute: ({ organizationId, companyId }, { to }) =>
      db().opsIncident.count({
        where: { organizationId, companyId, occurredAt: { lt: to }, OR: [{ status: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] } }, { resolvedAt: { gte: to } }] },
      }),
  },
];
