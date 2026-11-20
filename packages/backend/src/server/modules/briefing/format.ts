import { formatMoney, formatNumber } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { BriefingDecision, BriefingInsight, BriefingMetric } from "./types";

/** Pure text helpers shared by the email / WhatsApp renderers and the in-app page (no I/O). */

export function metricText(m: Pick<BriefingMetric, "unit" | "value">, locale: string, currency: string): string {
  if (m.value === null) return "—";
  if (m.unit === "money") return formatMoney({ amountMinor: BigInt(Math.round(m.value)), currency }, locale);
  if (m.unit === "percent") return `${formatNumber(m.value, locale, { maximumFractionDigits: 1 })}%`;
  return formatNumber(m.value, locale, { maximumFractionDigits: Number.isInteger(m.value) ? 0 : 1 });
}

export function changeText(m: Pick<BriefingMetric, "changePct">, locale: string): string | null {
  if (m.changePct === null) return null;
  const v = Math.round(m.changePct * 10) / 10;
  return `${v > 0 ? "+" : ""}${formatNumber(v, locale, { maximumFractionDigits: 1 })}%`;
}

const ISSUE_KINDS = new Set(["metric_drop", "metric_attention", "overdue_work_tasks", "overdue_follow_ups", "approvals_expiring", "ai_tasks_failed", "ai_employee_over_budget"]);

/** A bi health insight in the reader's language (same keys as the Intelligence pages). */
export function insightText(t: Translate, i: BriefingInsight): string {
  const p: Record<string, string | number> = { ...i.params };
  if (typeof p.metric === "string") p.metric = t(p.metric);
  if (typeof p.department === "string") p.department = t(`analytics.departments.${p.department}`);
  return ISSUE_KINDS.has(i.kind) ? t(`intelligence.issues.${i.kind}`, p) : t(`analytics.health.insight.${i.kind}`, p);
}

export function decisionText(t: Translate, d: BriefingDecision, locale: string, currency: string): string {
  if (d.kind === "fix_insight" && d.insight) return t("briefing.decision.fix_insight", { insight: insightText(t, d.insight) });
  if (d.kind === "chase_receivables") return t("briefing.decision.chase_receivables", { amount: formatMoney({ amountMinor: BigInt(Math.round(Number(d.params.amountMinor) || 0)), currency }, locale) });
  return t(`briefing.decision.${d.kind}`, d.params);
}

export const departmentLabel = (t: Translate, d: string) => {
  const key = `analytics.departments.${d}`;
  const v = t(key);
  return v === key ? d.charAt(0).toUpperCase() + d.slice(1) : v;
};
