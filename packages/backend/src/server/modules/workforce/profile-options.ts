import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import type { Translate } from "@/i18n/translate";
import { resolveProfile } from "@/server/modules/agents/role-profiles";
import { visibleMetrics } from "@/server/modules/bi/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { getTool, loadTools } from "@/server/modules/tools/registry";
import { allowedModels, defaultModel } from "./models";
import { getEmployee, kpisOf, listEmployees, listMembers } from "./service";

type Employee = Awaited<ReturnType<typeof getEmployee>>;

export const toolLabelOf = (t: Translate) => (name: string) => {
  const label = t(`workforce.toolNames.${name}`);
  return label === `workforce.toolNames.${name}` ? name.replace(/_/g, " ") : label;
};

/** Pickers for the profile form: managers, members, allowed models, KPI metrics and the role's tools. */
export async function profileOptions(ctx: RequestContext, organizationId: string, companyId: string, e: Employee, t: Translate) {
  await loadTools();
  const chain = await companyChain(db(), organizationId, companyId);
  const [employees, members, metrics] = await Promise.all([listEmployees(ctx, organizationId, companyId), listMembers(ctx, organizationId, companyId), visibleMetrics(ctx, chain)]);
  const label = toolLabelOf(t);
  return {
    employees: employees.filter((x) => x.id !== e.id).map((x) => ({ id: x.id, name: x.name })),
    members,
    models: allowedModels(),
    defaultModel: defaultModel(),
    metrics: metrics.map((m) => ({ key: m.key, label: t(m.labelKey) })).sort((a, b) => a.label.localeCompare(b.label)),
    tools: ((await resolveProfile({ organizationId, companyId }, e.profileKey))?.tools ?? []).flatMap((name) => {
      const d = getTool(name);
      return d ? [{ name, label: label(name), needsApproval: d.autonomy !== "AUTONOMOUS" }] : [];
    }),
  };
}

export const profileValues = (e: Employee) => ({
  jobTitle: e.jobTitle ?? "",
  jobDescription: e.jobDescription ?? "",
  instructions: e.instructions ?? "",
  skills: e.skills,
  model: e.model,
  managerEmployeeId: e.managerEmployeeId,
  managerUserId: e.managerUserId,
  level: e.level,
  responsibilities: e.responsibilities,
  goals: e.goals,
  kpis: kpisOf(e.kpis),
  autonomy: e.autonomy,
  runsAsUserId: e.runsAsUserId,
  monthlyTokenBudget: e.monthlyTokenBudget,
  /** Whole USD per month (the form edits dollars; stored as cents). */
  monthlyCostBudgetUsd: e.monthlyCostBudgetCents === null ? null : Number(e.monthlyCostBudgetCents) / 100,
  allowedTools: e.allowedTools,
});
