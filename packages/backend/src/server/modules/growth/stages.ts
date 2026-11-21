import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { MetricUnit } from "@/server/core/metrics";
import { resolveRange } from "@/server/modules/bi/range";
import { metricContext, metricValues, pickMetrics } from "@/server/modules/bi/service";
import { SIGNAL_STAGE } from "./signals";

/** The growth loop, in order. */
export const GROWTH_STAGES = ["research", "strategy", "product", "marketing", "leads", "sales", "customers", "revenue", "analytics", "optimization"] as const;
export type GrowthStage = (typeof GROWTH_STAGES)[number];

/** Registry metrics shown per stage (only those the viewer may see appear). */
const STAGE_METRICS: Record<GrowthStage, string[]> = {
  research: [],
  strategy: ["bi.objectives_active", "bi.milestones_completed"],
  product: ["work.active_projects", "work.tasks_completed", "work.overdue_tasks"],
  marketing: ["marketing.active_campaigns", "marketing.spend", "marketing.campaign_roi"],
  leads: ["crm.new_leads", "marketing.leads_generated"],
  sales: ["crm.open_pipeline", "crm.win_rate", "crm.won_revenue"],
  customers: ["support.tickets_opened", "support.sla_breach_rate"],
  revenue: ["finance.revenue", "finance.mrr", "finance.net_profit"],
  analytics: [],
  optimization: [],
};

export interface StageValue {
  key: string;
  /** i18n key of the label. */
  labelKey: string;
  unit: MetricUnit;
  value: number | null;
  changePct: number | null;
  trend: -1 | 0 | 1;
  href: string | null;
}

/** Real stage metrics for the last 30 days (vs the 30 before) plus open insights per stage. */
export async function loopStages(ctx: RequestContext, organizationId: string, companyId: string) {
  const { scope, metrics } = await metricContext(ctx, organizationId, companyId);
  const keys = Object.values(STAGE_METRICS).flat();
  const values = await metricValues(pickMetrics(metrics, keys), scope, resolveRange("30d"));
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [docs, research, customers, openInsights, acted, growthTasks] = await Promise.all([
    db().brainDocument.count({ where: { organizationId, companyId, status: "READY" } }),
    db().agentTask.count({ where: { organizationId, companyId, profile: { in: ["research_analyst", "bi_analyst"] }, status: "COMPLETED", completedAt: { gte: since } } }),
    db().account.count({ where: { organizationId, companyId, type: "CUSTOMER", archivedAt: null } }),
    db().growthInsight.groupBy({ by: ["signal"], where: { organizationId, companyId, status: "OPEN" }, _count: { _all: true } }),
    db().growthInsight.count({ where: { organizationId, companyId, status: "ACTED", actedAt: { gte: since } } }),
    db().agentTask.count({ where: { organizationId, companyId, subjectType: "growth_insight", status: "COMPLETED", completedAt: { gte: since } } }),
  ]);
  const custom: Partial<Record<GrowthStage, StageValue[]>> = {
    research: [
      { key: "brain_documents", labelKey: "growth.stageMetrics.brainDocuments", unit: "count", value: docs, changePct: null, trend: 0, href: "/brain" },
      { key: "research_tasks", labelKey: "growth.stageMetrics.researchTasks", unit: "count", value: research, changePct: null, trend: 0, href: "/tasks?status=COMPLETED" },
    ],
    customers: [{ key: "customers", labelKey: "growth.stageMetrics.customers", unit: "count", value: customers, changePct: null, trend: 0, href: "/customers" }],
    analytics: [
      { key: "kpis_tracked", labelKey: "growth.stageMetrics.kpisTracked", unit: "count", value: metrics.length, changePct: null, trend: 0, href: "/analytics" },
      { key: "insights_open", labelKey: "growth.stageMetrics.insightsOpen", unit: "count", value: openInsights.reduce((a, r) => a + r._count._all, 0), changePct: null, trend: 0, href: "/intelligence/growth?status=OPEN" },
    ],
    optimization: [
      { key: "insights_acted", labelKey: "growth.stageMetrics.insightsActed", unit: "count", value: acted, changePct: null, trend: 0, href: "/intelligence/growth?status=ACTED" },
      { key: "growth_tasks", labelKey: "growth.stageMetrics.growthTasks", unit: "count", value: growthTasks, changePct: null, trend: 0, href: "/tasks" },
    ],
  };
  const signalsByStage = new Map<string, number>();
  for (const r of openInsights) signalsByStage.set(SIGNAL_STAGE[r.signal], (signalsByStage.get(SIGNAL_STAGE[r.signal]) ?? 0) + r._count._all);
  return {
    currency: scope.currency,
    stages: GROWTH_STAGES.map((stage) => ({
      stage,
      openInsights: signalsByStage.get(stage) ?? 0,
      values: [
        ...(custom[stage] ?? []),
        ...STAGE_METRICS[stage].flatMap((k) => {
          const v = values.find((x) => x.key === k);
          return v ? [{ key: v.key, labelKey: v.labelKey, unit: v.unit, value: v.value, changePct: v.changePct, trend: v.trend, href: v.href }] : [];
        }),
      ],
    })),
  };
}
