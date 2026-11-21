import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { authorize, todayUtc } from "./access";

/** Aggregated workforce numbers (no personal data, no salaries) for the HR overview and the people analyst. */
export async function headcountSummary(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "hr.read");
  const base = { organizationId, companyId, archivedAt: null };
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 86_400_000);
  const d365 = new Date(now.getTime() - 365 * 86_400_000);
  const [byStatus, byType, byDept, departments, joined90, left365, openJobs, activeCandidates, pendingLeave, onLeaveToday, current] = await Promise.all([
    db().employee.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db().employee.groupBy({ by: ["employmentType"], where: { ...base, status: { not: "TERMINATED" } }, _count: { _all: true } }),
    db().employee.groupBy({ by: ["departmentId"], where: { ...base, status: { not: "TERMINATED" } }, _count: { _all: true } }),
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true } }),
    db().employee.count({ where: { ...base, startDate: { gte: d90 } } }),
    db().employee.count({ where: { organizationId, companyId, status: "TERMINATED", endDate: { gte: d365 } } }),
    db().hrJob.findMany({ where: { organizationId, companyId, status: "OPEN" }, select: { openings: true } }),
    db().hrCandidate.count({ where: { organizationId, companyId, archivedAt: null, stage: { in: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER"] } } }),
    db().hrLeaveRequest.count({ where: { organizationId, companyId, status: "PENDING" } }),
    db().hrLeaveRequest.count({ where: { organizationId, companyId, status: "APPROVED", startDate: { lte: todayUtc() }, endDate: { gte: todayUtc() } } }),
    db().employee.findMany({ where: { ...base, status: { not: "TERMINATED" } }, select: { startDate: true, managerId: true } }),
  ]);
  const headcount = current.length;
  const tenures = current.filter((e) => e.startDate).map((e) => (now.getTime() - e.startDate!.getTime()) / (365.25 * 86_400_000));
  const spans = new Map<string, number>();
  for (const e of current) if (e.managerId) spans.set(e.managerId, (spans.get(e.managerId) ?? 0) + 1);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  return {
    headcount,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>,
    byType: Object.fromEntries(byType.map((s) => [s.employmentType, s._count._all])) as Record<string, number>,
    byDepartment: byDept.map((d) => ({ name: d.departmentId ? (deptName.get(d.departmentId) ?? "—") : null, count: d._count._all })).sort((a, b) => b.count - a.count),
    newHires90d: joined90,
    leavers12m: left365,
    attrition12mPercent: headcount + left365 ? Math.round((left365 / ((headcount + left365 + headcount) / 2)) * 1000) / 10 : 0,
    averageTenureYears: tenures.length ? Math.round((tenures.reduce((a, b) => a + b, 0) / tenures.length) * 10) / 10 : null,
    managers: spans.size,
    averageSpanOfControl: spans.size ? Math.round(([...spans.values()].reduce((a, b) => a + b, 0) / spans.size) * 10) / 10 : null,
    maxSpanOfControl: spans.size ? Math.max(...spans.values()) : null,
    openPositions: openJobs.reduce((n, j) => n + j.openings, 0),
    openJobs: openJobs.length,
    activeCandidates,
    pendingLeaveRequests: pendingLeave,
    onLeaveToday,
  };
}
