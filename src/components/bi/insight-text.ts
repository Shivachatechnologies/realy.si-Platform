import type { Translate } from "@/i18n/translate";
import type { Insight } from "@/server/modules/bi/health";

/** Translate an insight's params (metric label keys and department keys become words). */
function params(t: Translate, i: Insight) {
  const p: Record<string, string | number> = { ...i.params };
  if (typeof p.metric === "string") p.metric = t(p.metric);
  if (typeof p.department === "string") p.department = t(`analytics.departments.${p.department}`);
  return p;
}

const ISSUE_KINDS = new Set(["metric_drop", "metric_attention", "overdue_work_tasks", "overdue_follow_ups", "approvals_expiring", "ai_tasks_failed", "ai_employee_over_budget"]);

/** What the insight says, in the viewer's language. */
export function insightText(t: Translate, i: Insight) {
  return ISSUE_KINDS.has(i.kind) ? t(`intelligence.issues.${i.kind}`, params(t, i)) : t(`analytics.health.insight.${i.kind}`, params(t, i));
}

/** The command "Do this" hands to AI Command (plain language, viewer's language). */
export function insightCommand(t: Translate, i: Insight) {
  return t(`analytics.health.do.${i.kind}`, params(t, i));
}
