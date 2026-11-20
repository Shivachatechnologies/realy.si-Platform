import type { MetricDefinition, MetricRange, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";

/** KPIs of the hr module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */

/** Employees on the books at an instant (started by then and not yet ended). */
async function headcountAt(scope: MetricScope, at: Date) {
  return db().employee.count({
    where: {
      organizationId: scope.organizationId,
      companyId: scope.companyId,
      OR: [{ startDate: { lt: at } }, { startDate: null, createdAt: { lt: at } }],
      AND: [{ OR: [{ endDate: null, status: { not: "TERMINATED" } }, { endDate: { gte: at } }] }],
    },
  });
}

async function leavers(scope: MetricScope, r: MetricRange) {
  return db().employee.count({ where: { organizationId: scope.organizationId, companyId: scope.companyId, status: "TERMINATED", endDate: { gte: r.from, lt: r.to } } });
}

export const HR_METRICS: MetricDefinition[] = [
  {
    key: "hr.headcount",
    labelKey: "hr.metrics.headcount",
    department: "hr",
    unit: "count",
    permission: "hr.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/hr/employees",
    compute: (scope, r) => headcountAt(scope, r.to),
  },
  {
    key: "hr.new_hires",
    labelKey: "hr.metrics.newHires",
    department: "hr",
    unit: "count",
    permission: "hr.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/hr/employees?sort=start&dir=desc",
    compute: (scope, r) => db().employee.count({ where: { organizationId: scope.organizationId, companyId: scope.companyId, startDate: { gte: r.from, lt: r.to } } }),
  },
  {
    key: "hr.attrition",
    labelKey: "hr.metrics.attrition",
    department: "hr",
    unit: "percent",
    permission: "hr.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/hr/employees?status=TERMINATED",
    async compute(scope, r) {
      const [left, start, end] = await Promise.all([leavers(scope, r), headcountAt(scope, r.from), headcountAt(scope, r.to)]);
      const avg = (start + end) / 2;
      return avg ? Math.round((left / avg) * 1000) / 10 : 0;
    },
  },
  {
    key: "hr.open_positions",
    labelKey: "hr.metrics.openPositions",
    department: "hr",
    unit: "count",
    permission: "hr.read",
    kind: "stock",
    href: "/hr/recruiting",
    async compute(scope, r) {
      const jobs = await db().hrJob.findMany({
        where: { organizationId: scope.organizationId, companyId: scope.companyId, publishedAt: { lt: r.to }, OR: [{ closedAt: null, status: "OPEN" }, { closedAt: { gte: r.to } }] },
        select: { openings: true },
      });
      return jobs.reduce((n, j) => n + j.openings, 0);
    },
  },
  {
    key: "hr.time_to_hire",
    labelKey: "hr.metrics.timeToHire",
    department: "hr",
    unit: "days",
    permission: "hr.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/hr/recruiting",
    async compute(scope, r) {
      const hired = await db().hrCandidate.findMany({ where: { organizationId: scope.organizationId, companyId: scope.companyId, stage: "HIRED", hiredAt: { gte: r.from, lt: r.to } }, select: { appliedAt: true, hiredAt: true } });
      if (!hired.length) return 0;
      const total = hired.reduce((n, c) => n + (c.hiredAt!.getTime() - c.appliedAt.getTime()) / 86_400_000, 0);
      return Math.round((total / hired.length) * 10) / 10;
    },
  },
  {
    key: "hr.leave_days",
    labelKey: "hr.metrics.leaveDays",
    department: "hr",
    unit: "days",
    permission: "hr.read",
    kind: "flow",
    href: "/hr/leave",
    async compute(scope, r) {
      const agg = await db().hrLeaveRequest.aggregate({ where: { organizationId: scope.organizationId, companyId: scope.companyId, status: "APPROVED", startDate: { gte: r.from, lt: r.to } }, _sum: { days: true } });
      return agg._sum.days ?? 0;
    },
  },
  {
    key: "hr.payroll_cost",
    labelKey: "hr.metrics.payrollCost",
    department: "hr",
    unit: "money",
    permission: "payroll.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/hr/payroll",
    async compute(scope, r) {
      const agg = await db().hrPayrollRun.aggregate({
        where: { organizationId: scope.organizationId, companyId: scope.companyId, currency: scope.currency, status: { in: ["APPROVED", "PAID"] }, period: { payDate: { gte: r.from, lt: r.to } } },
        _sum: { totalGrossMinor: true },
      });
      return agg._sum.totalGrossMinor ?? 0n;
    },
  },
];
