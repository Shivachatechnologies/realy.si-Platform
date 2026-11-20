import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import type { MetricDefinition, MetricScope } from "@/server/core/metrics";
import { employeeMonthUsage } from "@/server/modules/workforce/usage";
import { metricValues, type MetricValue } from "./service";
import { resolveRange } from "./range";

export interface Issue {
  severity: "critical" | "warning";
  /** i18n key suffix under intelligence.issues.<kind>. */
  kind: "metric_drop" | "metric_attention" | "overdue_work_tasks" | "overdue_follow_ups" | "approvals_expiring" | "ai_tasks_failed" | "ai_employee_over_budget";
  params: Record<string, string | number>;
  href?: string;
  metricKey?: string;
}

const DROP_WARNING = -20;
const DROP_CRITICAL = -40;
const ATTENTION = /overdue|breach|failed|churn|late/;

/**
 * Critical issues, computed deterministically (no AI): negative trends over the last 7 days vs the 7 before, metrics
 * that flag problems (overdue, breaches), overdue work and follow-ups, expiring approvals, failed AI tasks and AI
 * employees over budget. Each source is included only when the viewer may read it.
 */
export async function criticalIssues(ctx: RequestContext, chain: ScopeChain, scope: MetricScope, metrics: MetricDefinition[], precomputed?: MetricValue[]): Promise<Issue[]> {
  const { organizationId, companyId } = scope;
  const issues: Issue[] = [];
  const week = precomputed ?? (await metricValues(metrics, scope, resolveRange("7d")));
  for (const v of week) {
    if (v.value === null) continue;
    if (v.trend === -1 && v.changePct !== null && (v.higherIsBetter ? v.changePct <= DROP_WARNING : v.changePct >= -DROP_WARNING)) {
      const severe = v.higherIsBetter ? v.changePct <= DROP_CRITICAL : v.changePct >= -DROP_CRITICAL;
      issues.push({ severity: severe ? "critical" : "warning", kind: "metric_drop", params: { metric: v.labelKey, change: Math.round(v.changePct) }, href: v.href ?? undefined, metricKey: v.key });
    } else if (v.higherIsBetter === false && v.value > 0 && ATTENTION.test(v.key)) {
      issues.push({ severity: "warning", kind: "metric_attention", params: { metric: v.labelKey, value: v.value }, href: v.href ?? undefined, metricKey: v.key });
    }
  }
  const allowed = async (p: string) => {
    try {
      return await can(ctx, p, chain);
    } catch {
      return false;
    }
  };
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [work, followUps, approvals, failed, employees] = await Promise.all([
    allowed("projects.read").then((ok) => (ok ? db().workTask.count({ where: { organizationId, companyId, dueDate: { lt: today }, status: { notIn: ["DONE", "CANCELLED"] } } }) : 0)),
    allowed("sales.read").then((ok) => (ok ? db().leadFollowUp.count({ where: { organizationId, companyId, completedAt: null, dueAt: { lt: now } } }) : 0)),
    allowed("approvals.read").then((ok) =>
      ok ? db().approval.count({ where: { organizationId, companyId, status: "PENDING", expiresAt: { gt: now, lt: new Date(now.getTime() + 24 * 3_600_000) } } }) : 0,
    ),
    allowed("agents.read").then((ok) => (ok ? db().agentTask.count({ where: { organizationId, companyId, status: "FAILED", completedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } }) : 0)),
    allowed("agents.read").then((ok) =>
      ok ? db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null, monthlyTokenBudget: { not: null } }, select: { id: true, name: true, monthlyTokenBudget: true } }) : [],
    ),
  ]);
  if (work) issues.push({ severity: work >= 10 ? "critical" : "warning", kind: "overdue_work_tasks", params: { count: work }, href: "/projects" });
  if (followUps) issues.push({ severity: followUps >= 10 ? "critical" : "warning", kind: "overdue_follow_ups", params: { count: followUps }, href: "/crm" });
  if (approvals) issues.push({ severity: "warning", kind: "approvals_expiring", params: { count: approvals }, href: "/approvals" });
  if (failed) issues.push({ severity: failed >= 5 ? "critical" : "warning", kind: "ai_tasks_failed", params: { count: failed }, href: "/tasks?status=FAILED" });
  for (const e of employees) {
    if ((await employeeMonthUsage(organizationId, companyId, e)).exhausted) {
      issues.push({ severity: "warning", kind: "ai_employee_over_budget", params: { name: e.name }, href: `/workforce/${e.id}` });
    }
  }
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

/** English one-liners (for AI prompts); `label` resolves a metric label key. */
export function issueText(i: Issue, label: (key: string) => string): string {
  const p = i.params;
  switch (i.kind) {
    case "metric_drop":
      return `${label(String(p.metric))} moved ${p.change}% vs the previous 7 days (in the wrong direction)`;
    case "metric_attention":
      return `${label(String(p.metric))} is ${p.value}`;
    case "overdue_work_tasks":
      return `${p.count} work tasks are overdue`;
    case "overdue_follow_ups":
      return `${p.count} CRM follow-ups are overdue`;
    case "approvals_expiring":
      return `${p.count} approval requests expire within 24 hours`;
    case "ai_tasks_failed":
      return `${p.count} AI tasks failed in the last 24 hours`;
    case "ai_employee_over_budget":
      return `AI employee ${p.name} has used this month's token budget`;
  }
}
