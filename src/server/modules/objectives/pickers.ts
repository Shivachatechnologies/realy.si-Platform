import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { Translate } from "@/i18n/translate";
import { visibleMetrics } from "@/server/modules/bi/service";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { eligibleUserIds } from "@/server/modules/work/shared";
import { eligibleMembers } from "./service";

/** Options for the objectives area's pickers (goals, departments, owners, metrics), each limited to what the viewer may see. */

export async function goalOptions(organizationId: string, companyId: string) {
  const rows = await db().companyGoal.findMany({ where: { organizationId, companyId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true } });
  return rows.map((g) => ({ id: g.id, name: g.title }));
}

export async function departmentOptions(organizationId: string, companyId: string) {
  return db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } });
}

async function usersById(ids: string[]) {
  return db().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Members who can read objectives (objective/goal owners). */
export async function objectiveOwnerOptions(organizationId: string, chain: ScopeChain) {
  return usersById(await eligibleMembers(db(), organizationId, chain, "objectives.read"));
}

/** Members who can work in projects (project owners, task assignees). */
export async function workPeopleOptions(organizationId: string, chain: ScopeChain) {
  return usersById(await eligibleUserIds(db(), organizationId, chain, "projects.read"));
}

/** Employees linked to a user, with department and title — only for viewers with hr.read. */
export async function linkedEmployees(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain) {
  if (!(await can(ctx, "hr.read", chain))) return null;
  return db().employee.findMany({
    where: { organizationId, companyId, userId: { not: null }, status: { not: "TERMINATED" } },
    take: 1000,
    select: { userId: true, firstName: true, lastName: true, title: true, departmentId: true, department: { select: { name: true, headId: true } }, id: true },
  });
}

export async function metricOptions(ctx: RequestContext, chain: ScopeChain, t: Translate) {
  const metrics = await visibleMetrics(ctx, chain);
  return metrics.map((m) => ({ key: m.key, label: `${t(m.labelKey)} (${m.key})`, unit: m.unit })).sort((a, b) => a.label.localeCompare(b.label));
}
