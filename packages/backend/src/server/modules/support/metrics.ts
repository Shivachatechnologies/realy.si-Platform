import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

/** KPIs of the support module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const SUPPORT_METRICS: MetricDefinition[] = [
  {
    key: "support.tickets_opened",
    labelKey: "support.metrics.ticketsOpened",
    department: "support",
    unit: "count",
    permission: "support.read",
    kind: "flow",
    href: "/support?view=all",
    compute: ({ organizationId, companyId }, { from, to }) => db().supportTicket.count({ where: { organizationId, companyId, createdAt: { gte: from, lt: to } } }),
  },
  {
    key: "support.tickets_solved",
    labelKey: "support.metrics.ticketsSolved",
    department: "support",
    unit: "count",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/support?view=solved",
    compute: ({ organizationId, companyId }, { from, to }) => db().supportTicket.count({ where: { organizationId, companyId, solvedAt: { gte: from, lt: to } } }),
  },
  {
    key: "support.avg_first_response_hours",
    labelKey: "support.metrics.avgFirstResponse",
    department: "support",
    unit: "hours",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: false,
    async compute({ organizationId, companyId }, { from, to }) {
      const rows = await db().supportTicket.findMany({ where: { organizationId, companyId, firstRespondedAt: { gte: from, lt: to } }, select: { createdAt: true, firstRespondedAt: true }, take: 10_000 });
      if (!rows.length) return 0;
      return hours(rows.reduce((s, r) => s + (r.firstRespondedAt!.getTime() - r.createdAt.getTime()), 0) / rows.length);
    },
  },
  {
    key: "support.avg_resolution_hours",
    labelKey: "support.metrics.avgResolution",
    department: "support",
    unit: "hours",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: false,
    async compute({ organizationId, companyId }, { from, to }) {
      const rows = await db().supportTicket.findMany({ where: { organizationId, companyId, solvedAt: { gte: from, lt: to } }, select: { createdAt: true, solvedAt: true }, take: 10_000 });
      if (!rows.length) return 0;
      return hours(rows.reduce((s, r) => s + (r.solvedAt!.getTime() - r.createdAt.getTime()), 0) / rows.length);
    },
  },
  {
    key: "support.sla_breach_rate",
    labelKey: "support.metrics.slaBreachRate",
    department: "support",
    unit: "percent",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: false,
    async compute({ organizationId, companyId }, { from, to }) {
      const where = { organizationId, companyId, createdAt: { gte: from, lt: to }, OR: [{ firstResponseDueAt: { not: null } }, { resolutionDueAt: { not: null } }] };
      const [total, breached] = await Promise.all([
        db().supportTicket.count({ where }),
        db().supportTicket.count({ where: { ...where, AND: [{ OR: [{ firstResponseBreachedAt: { not: null } }, { resolutionBreachedAt: { not: null } }] }] } }),
      ]);
      return total ? Math.round((breached / total) * 1000) / 10 : 0;
    },
  },
  {
    key: "support.backlog",
    labelKey: "support.metrics.backlog",
    department: "support",
    unit: "count",
    permission: "support.read",
    kind: "stock",
    higherIsBetter: false,
    href: "/support?view=open",
    compute: ({ organizationId, companyId }, { to }) =>
      db().supportTicket.count({ where: { organizationId, companyId, createdAt: { lt: to }, OR: [{ solvedAt: null, closedAt: null }, { solvedAt: { gte: to } }] } }),
  },
];
