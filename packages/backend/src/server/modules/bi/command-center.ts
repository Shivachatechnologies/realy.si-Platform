import "server-only";
import type { RequestContext } from "@/server/core/context";
import type { MetricDefinition, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import type { ScopeChain } from "@/server/modules/rbac/scope";
import { checkLimit } from "@/server/modules/entitlements/service";
import { businessHealthFrom } from "./health";
import { pickMetrics, visibleMetrics, type MetricValue, type SeriesPoint } from "./service";
import { companySnapshot, growthMetricOf, snapshotSeries, snapshotValues } from "./snapshots";

/**
 * Everything metric-based on the Command Center from one per-company snapshot (bi/snapshots.ts): the KPI ribbon, the
 * growth chart, business health (score, forecasts, insights) and the live operations board. A warm render costs a
 * handful of queries (permissions, the company row, the snapshot read, the issue counts) instead of ~750.
 */

/** Department order for the KPI ribbon (most business-critical first). */
const KPI_ORDER = ["finance", "sales", "marketing", "support", "projects", "hr", "operations", "executive", "ai"];

/**
 * The operations board: areas of the company with the registry metrics that describe them. A metric the viewer may
 * not read is left out; an area with nothing visible says so instead of showing zeros.
 */
export const BOARD = [
  { area: "money", keys: ["finance.revenue", "finance.expenses", "finance.net_profit", "finance.cash_balance", "finance.burn_rate", "finance.runway_months", "finance.receivables_overdue"] },
  { area: "growth", keys: ["crm.new_leads", "crm.open_pipeline", "crm.won_revenue", "marketing.active_campaigns", "marketing.leads_generated", "marketing.spend"] },
  { area: "work", keys: ["work.active_projects", "work.tasks_completed", "work.overdue_tasks", "work.open_incidents", "bi.objectives_active"] },
  { area: "people", keys: ["hr.headcount", "hr.open_positions", "workforce.ai_employees_active", "workforce.ai_tasks_completed", "workforce.ai_cost_usd", "workforce.approvals_pending"] },
  { area: "customers", keys: ["voice.calls_connected", "voice.inbound_calls", "voice.meetings_booked", "comms.meetings_held", "support.backlog", "support.tickets_opened", "livechat.conversations"] },
  { area: "platform", keys: ["integrations.provider_usage", "integrations.provider_failures", "integrations.sync_errors", "workforce.ai_tasks_failed", "automation.failed_runs", "integrations.webhook_failures"] },
] as const;
export type BoardArea = (typeof BOARD)[number]["area"];

export interface CommandCenterMetrics {
  currency: string;
  computedAt: string;
  kpis: MetricValue[];
  growth: { metric: MetricDefinition; series: SeriesPoint[] } | null;
  health: Awaited<ReturnType<typeof businessHealthFrom>>;
  board: { area: BoardArea; values: MetricValue[] }[];
  /** AI credits this month (null when the viewer may not see billing). */
  credits: { used: number; limit: number | null } | null;
}

/** null when the viewer may not read analytics (the page shows that instead). */
export async function commandCenterMetrics(ctx: RequestContext, organizationId: string, companyId: string, chain: ScopeChain): Promise<CommandCenterMetrics | null> {
  if (!(await can(ctx, "analytics.read", chain))) return null;
  const [company, metrics, canBilling] = await Promise.all([
    db().company.findFirst({ where: { id: companyId, organizationId }, select: { baseCurrency: true } }),
    visibleMetrics(ctx, chain),
    can(ctx, "billing.read", chain),
  ]);
  if (!company) return null;
  const scope: MetricScope = { organizationId, companyId, currency: company.baseCurrency };
  const snap = await companySnapshot(scope, { viewed: true });
  const picked = [...metrics].sort((a, b) => KPI_ORDER.indexOf(a.department) - KPI_ORDER.indexOf(b.department)).slice(0, 8);
  const growthMetric = growthMetricOf(metrics);
  const [kpis, series, health, board, credits] = await Promise.all([
    snapshotValues(snap, scope, picked, "30d"),
    growthMetric ? snapshotSeries(snap, scope, growthMetric).catch(() => null) : null,
    businessHealthFrom(ctx, chain, scope, metrics, snap),
    Promise.all(BOARD.map(async (b) => ({ area: b.area, values: await snapshotValues(snap, scope, pickMetrics(metrics, [...b.keys]), "30d") }))),
    canBilling ? checkLimit(organizationId, "ai.credits.month", 0).then((c) => ({ used: c.used, limit: c.limit }), () => null) : null,
  ]);
  return { currency: scope.currency, computedAt: snap.computedAt, kpis, growth: growthMetric && series ? { metric: growthMetric, series } : null, health, board, credits };
}
