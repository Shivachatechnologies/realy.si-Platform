import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import type { MetricRange } from "@/server/core/metrics";
import { can } from "@/server/modules/rbac/service";
import { kpisOf } from "@/server/modules/workforce/service";
import { criticalIssues } from "./issues";
import { metricContext, metricSeries, metricValues, pickMetrics, type MetricValue } from "./service";

/** CEO dashboard sections (metric registry keys; only those the viewer may see are shown). */
export const CEO_SECTIONS = {
  revenue: ["finance.revenue", "finance.mrr", "finance.arr"],
  expenses: ["finance.expenses", "finance.burn_rate", "finance.payables_open", "finance.budget_utilization"],
  cashFlow: ["finance.cash_balance", "finance.net_profit", "finance.runway_months", "finance.receivables_overdue"],
  sales: ["crm.won_revenue", "crm.open_pipeline", "crm.weighted_pipeline", "crm.win_rate"],
  leads: ["crm.new_leads", "crm.conversion_rate", "marketing.leads_generated", "crm.sales_cycle_days"],
  marketing: ["marketing.spend", "marketing.campaign_roi", "marketing.cac", "marketing.active_campaigns"],
  projects: ["work.active_projects", "work.tasks_completed", "work.overdue_tasks", "work.on_time_completion", "work.open_risks"],
  team: ["hr.headcount", "hr.open_positions", "hr.new_hires", "hr.attrition", "hr.payroll_cost"],
  ai: ["workforce.ai_employees_active", "workforce.ai_tasks_completed", "workforce.ai_tasks_failed", "workforce.ai_cost_usd"],
  goals: ["bi.objectives_active", "bi.milestones_completed", "bi.milestones_overdue"],
} as const;
export type CeoSection = keyof typeof CEO_SECTIONS;

/** Positive movement of at least this much (in the good direction) counts as an opportunity. */
const OPPORTUNITY_PCT = 20;

const allowed = async (ctx: RequestContext, p: string, chain: Parameters<typeof can>[2]) => {
  try {
    return await can(ctx, p, chain);
  } catch {
    return false;
  }
};

export async function ceoDashboard(ctx: RequestContext, organizationId: string, companyId: string, range: MetricRange) {
  const { chain, scope, metrics } = await metricContext(ctx, organizationId, companyId);
  const keys = Object.values(CEO_SECTIONS).flat();
  const chosen = pickMetrics(metrics, keys);
  const values = await metricValues(chosen, scope, range);
  const byKey = new Map(values.map((v) => [v.key, v]));
  const sections = (Object.keys(CEO_SECTIONS) as CeoSection[]).map((s) => ({ section: s, values: CEO_SECTIONS[s].flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])) })).filter((s) => s.values.length);

  const revenue = chosen.find((m) => m.key === "finance.revenue");
  const expenses = chosen.find((m) => m.key === "finance.expenses");
  const [revenueSeries, expenseSeries, issues, canApprovals, canAgents, canObjectives] = await Promise.all([
    revenue ? metricSeries(revenue, scope, range, 12) : null,
    expenses ? metricSeries(expenses, scope, range, 12) : null,
    criticalIssues(ctx, chain, scope, metrics),
    allowed(ctx, "approvals.read", chain),
    allowed(ctx, "agents.read", chain),
    allowed(ctx, "objectives.read", chain),
  ]);
  const now = new Date();
  const [approvals, pendingCount, growthOpps, employees, objectives] = await Promise.all([
    canApprovals ? db().approval.findMany({ where: { organizationId, companyId, status: "PENDING", expiresAt: { gt: now } }, orderBy: { expiresAt: "asc" }, take: 8, select: { id: true, summary: true, risk: true, expiresAt: true, tool: true } }) : null,
    canApprovals ? db().approval.count({ where: { organizationId, companyId, status: "PENDING", expiresAt: { gt: now } } }) : null,
    canAgents ? db().growthInsight.findMany({ where: { organizationId, companyId, status: "OPEN", signal: "STRONG_CAMPAIGN" }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, signal: true, evidence: true } }) : [],
    canAgents ? db().aiEmployee.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true, kpis: true } }) : [],
    canObjectives
      ? db().objective.findMany({ where: { organizationId, companyId, status: "ACTIVE" }, orderBy: { targetDate: "asc" }, take: 6, select: { id: true, title: true, targetDate: true, milestones: { select: { completedAt: true } } } })
      : null,
  ]);

  // AI employee KPI targets with the actual value for the range (goals/KPIs).
  const targets = employees.flatMap((e) => kpisOf(e.kpis).map((k) => ({ employeeId: e.id, employee: e.name, key: k.key, target: k.target })));
  const targetMetrics = pickMetrics(metrics, [...new Set(targets.map((t) => t.key))]);
  const targetValues = await metricValues(targetMetrics.filter((m) => !byKey.has(m.key)), scope, range);
  const all = new Map<string, MetricValue>([...byKey, ...targetValues.map((v) => [v.key, v] as const)]);
  const kpiTargets = targets.flatMap((t) => {
    const v = all.get(t.key);
    return v ? [{ ...t, labelKey: v.labelKey, unit: v.unit, value: v.value, higherIsBetter: v.higherIsBetter, onTrack: v.value === null ? null : v.higherIsBetter === false ? v.value <= t.target : v.value >= t.target }] : [];
  });

  const opportunities = [
    ...values.filter((v) => v.trend === 1 && v.changePct !== null && Math.abs(v.changePct) >= OPPORTUNITY_PCT).map((v) => ({ kind: "metric" as const, key: v.key, labelKey: v.labelKey, changePct: v.changePct!, href: v.href })),
    ...growthOpps.map((g) => ({ kind: "insight" as const, key: g.id, labelKey: "growth.signals.STRONG_CAMPAIGN.title", changePct: null, href: "/intelligence/growth" })),
  ].slice(0, 8);

  return {
    currency: scope.currency,
    sections,
    revenueSeries,
    expenseSeries,
    risks: issues,
    opportunities,
    approvals: approvals ? { pending: pendingCount ?? 0, items: approvals } : null,
    kpiTargets,
    objectives: objectives?.map((o) => ({ id: o.id, title: o.title, targetDate: o.targetDate, done: o.milestones.filter((m) => m.completedAt).length, total: o.milestones.length })) ?? null,
  };
}
