import { db } from "@/server/core/db";
import type { MetricScope } from "@/server/core/metrics";
import type { GrowthSeverity, GrowthSignal } from "@/generated/prisma/enums";
import { metricByKey } from "@/server/modules/bi/registry";
import { computeMetric } from "@/server/modules/bi/service";
import { previousRange, resolveRange } from "@/server/modules/bi/range";

export const GROWTH_SIGNALS = ["NO_CUSTOMERS", "LOW_CONVERSION", "REVENUE_DECLINE", "PROJECTS_DELAYED", "COMPLAINTS_UP", "STRONG_CAMPAIGN", "DECISION_OVERLOAD"] as const satisfies readonly GrowthSignal[];

export interface FiredSignal {
  signal: GrowthSignal;
  severity: GrowthSeverity;
  /** Numbers only (metric values, previous values, thresholds). */
  evidence: Record<string, number | string | null>;
}

/** Who acts on a signal (profile keys in order of preference; the AI CEO is the fallback). */
export const RESPONSIBLE: Record<GrowthSignal, string[]> = {
  NO_CUSTOMERS: ["cmo", "sales_manager"],
  LOW_CONVERSION: ["sales_manager"],
  REVENUE_DECLINE: ["ai_cfo"],
  PROJECTS_DELAYED: ["ai_project_manager"],
  COMPLAINTS_UP: ["support_lead", "support_agent"],
  STRONG_CAMPAIGN: ["cmo"],
  DECISION_OVERLOAD: ["ai_ceo"],
};

/** The loop stage a signal belongs to (Growth page). */
export const SIGNAL_STAGE: Record<GrowthSignal, string> = {
  NO_CUSTOMERS: "customers",
  LOW_CONVERSION: "sales",
  REVENUE_DECLINE: "revenue",
  PROJECTS_DELAYED: "product",
  COMPLAINTS_UP: "customers",
  STRONG_CAMPAIGN: "marketing",
  DECISION_OVERLOAD: "strategy",
};

/** What to ask the responsible AI employee for each signal (English; the evidence is appended). */
export const SIGNAL_BRIEF: Record<GrowthSignal, string> = {
  NO_CUSTOMERS: "The company has no customers yet. Work out the fastest path to the first paying customers: ideal customer profile, the best acquisition channels for it, an outreach / campaign plan for the next two weeks, and how leads will be followed up.",
  LOW_CONVERSION: "Lead-to-deal conversion dropped compared with the previous period. Find where leads stall (stages, sources, follow-up speed, owners), name the causes with evidence and give a concrete plan to recover conversion.",
  REVENUE_DECLINE: "Revenue declined compared with the previous period. Explain what drove the decline (customers, products, invoicing, collections), quantify it, assess the cash impact and recommend corrective actions.",
  PROJECTS_DELAYED: "Projects are delayed: work tasks and/or milestones are overdue. Identify the delayed work, the owners and the blockers, and give a recovery plan with priorities and new dates.",
  COMPLAINTS_UP: "Customer complaints are up: more support tickets were opened than in the previous period. Find the common causes, the affected customers and the SLA impact, and recommend fixes and responses.",
  STRONG_CAMPAIGN: "Marketing performance improved strongly. Find which campaigns / channels drove it and recommend how to scale what works (budget, audiences, content) while watching acquisition cost.",
  DECISION_OVERLOAD: "Too many decisions are waiting for the founder (pending approvals). Prepare a prioritised decision list: what each item is, the recommendation, the risk, and which items could be delegated or handled by a lower autonomy level next time.",
};

const metric = async (key: string, scope: MetricScope, range: { from: Date; to: Date }) => {
  const m = metricByKey(key);
  return m ? computeMetric(m, scope, range) : null;
};
const pct = (cur: number, prev: number) => Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;

/**
 * Evaluate every signal from real data (metric registry + tables). Deterministic: no AI. Metrics that are unavailable
 * (module missing, failure) never fire a signal.
 */
export async function evaluateSignals(scope: MetricScope, opts: { decisionThreshold: number }, now = new Date()): Promise<FiredSignal[]> {
  const { organizationId, companyId } = scope;
  const month = resolveRange("30d", undefined, undefined, now);
  const prevMonth = previousRange(month);
  const week = resolveRange("7d", undefined, undefined, now);
  const prevWeek = previousRange(week);
  const fired: FiredSignal[] = [];

  const [customers, conv, convPrev, newLeads, revenue, revenuePrev, overdueTasks, overdueMilestones, tickets, ticketsPrev, roi, roiPrev, mConv, mConvPrev, pending] = await Promise.all([
    db().account.count({ where: { organizationId, companyId, type: "CUSTOMER", archivedAt: null } }),
    metric("crm.conversion_rate", scope, month),
    metric("crm.conversion_rate", scope, prevMonth),
    metric("crm.new_leads", scope, month),
    metric("finance.revenue", scope, month),
    metric("finance.revenue", scope, prevMonth),
    metric("work.overdue_tasks", scope, month),
    metric("bi.milestones_overdue", scope, month),
    metric("support.tickets_opened", scope, week),
    metric("support.tickets_opened", scope, prevWeek),
    metric("marketing.campaign_roi", scope, week),
    metric("marketing.campaign_roi", scope, prevWeek),
    metric("marketing.conversion_rate", scope, week),
    metric("marketing.conversion_rate", scope, prevWeek),
    db().approval.count({ where: { organizationId, companyId, status: "PENDING", expiresAt: { gt: now } } }),
  ]);

  if (customers === 0) fired.push({ signal: "NO_CUSTOMERS", severity: "WARNING", evidence: { customers, newLeads30d: newLeads } });

  if (conv !== null && convPrev !== null && convPrev > 0 && conv < convPrev * 0.8) {
    fired.push({ signal: "LOW_CONVERSION", severity: conv <= convPrev * 0.5 ? "CRITICAL" : "WARNING", evidence: { conversionRate: conv, previousConversionRate: convPrev, changePct: pct(conv, convPrev), newLeads30d: newLeads } });
  } else if (conv !== null && newLeads !== null && newLeads >= 10 && conv < 5) {
    fired.push({ signal: "LOW_CONVERSION", severity: "WARNING", evidence: { conversionRate: conv, previousConversionRate: convPrev, newLeads30d: newLeads, threshold: 5 } });
  }

  if (revenue !== null && revenuePrev !== null && revenuePrev > 0 && revenue < revenuePrev * 0.9) {
    fired.push({ signal: "REVENUE_DECLINE", severity: revenue <= revenuePrev * 0.7 ? "CRITICAL" : "WARNING", evidence: { revenueMinor: revenue, previousRevenueMinor: revenuePrev, changePct: pct(revenue, revenuePrev), currency: scope.currency } });
  }

  const ot = overdueTasks ?? 0;
  const om = overdueMilestones ?? 0;
  if (ot >= 5 || om >= 1) fired.push({ signal: "PROJECTS_DELAYED", severity: ot >= 20 || om >= 3 ? "CRITICAL" : "WARNING", evidence: { overdueTasks, overdueMilestones } });

  if (tickets !== null && ticketsPrev !== null && tickets >= 5 && (ticketsPrev === 0 || tickets >= ticketsPrev * 1.25)) {
    fired.push({ signal: "COMPLAINTS_UP", severity: ticketsPrev > 0 && tickets >= ticketsPrev * 2 ? "CRITICAL" : "WARNING", evidence: { ticketsOpened7d: tickets, previous7d: ticketsPrev, changePct: ticketsPrev ? pct(tickets, ticketsPrev) : null } });
  }

  const roiUp = roi !== null && roiPrev !== null && roiPrev > 0 && roi > 0 && roi >= roiPrev * 1.2;
  const convUp = mConv !== null && mConvPrev !== null && mConvPrev > 0 && mConv >= mConvPrev * 1.2;
  if (roiUp || convUp) {
    fired.push({ signal: "STRONG_CAMPAIGN", severity: "INFO", evidence: { campaignRoi: roi, previousCampaignRoi: roiPrev, marketingConversionRate: mConv, previousMarketingConversionRate: mConvPrev } });
  }

  if (pending > opts.decisionThreshold) fired.push({ signal: "DECISION_OVERLOAD", severity: pending > opts.decisionThreshold * 2 ? "CRITICAL" : "WARNING", evidence: { pendingApprovals: pending, threshold: opts.decisionThreshold } });
  return fired;
}

/** ISO week key ("2026-W47") used to dedupe insights per signal per week. */
export function isoWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
