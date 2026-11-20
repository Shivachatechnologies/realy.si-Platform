import { formatMoney } from "@/i18n/format";

type Translate = (key: string, values?: Record<string, string | number>) => string;
const KNOWN_ISSUES = new Set(["metric_drop", "metric_attention", "overdue_work_tasks", "overdue_follow_ups"]);

/** Params with metric label keys translated (health issues carry the metric's label key). */
export function tParams(t: Translate, params: Record<string, string | number>) {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) out[k] = k === "metric" && typeof v === "string" && v.includes(".") ? t(v) : v;
  return out;
}

/** An AI CEO priority in plain language (headline + why), from its kind and the real-data params stored with it. */
export function describePriority(t: Translate, locale: string, p: { kind: string; params: Record<string, string | number> }) {
  const params = tParams(t, p.params);
  if (p.kind === "objective") {
    const status = params.status === "OFF_TRACK" ? "OFF_TRACK" : "AT_RISK";
    return { title: t("command.ceo.priority.objective", { objective: String(params.objective ?? ""), progress: Number(params.progress ?? 0) }), why: t(`command.ceo.why.objective_${status}`, { kr: String(params.kr || "—") }) };
  }
  if (p.kind === "health" && typeof params.issue === "string" && KNOWN_ISSUES.has(params.issue)) {
    return { title: t(`command.ceo.priority.health_${params.issue}`, params), why: t(`intelligence.issues.${params.issue}`, params) };
  }
  if (p.kind === "cash") {
    const amount = formatMoney({ amountMinor: BigInt(Math.round(Number(params.amount ?? 0) * 100)), currency: String(params.currency ?? "USD") }, locale);
    return { title: t("command.ceo.priority.cash", { count: Number(params.count ?? 0), amount }), why: t("command.ceo.why.cash") };
  }
  if (p.kind === "pipeline") return { title: t("command.ceo.priority.pipeline", { count: Number(params.count ?? 0) }), why: t("command.ceo.why.pipeline", { count: Number(params.count ?? 0), open: Number(params.open ?? 0) }) };
  return { title: t("command.ceo.priority.other"), why: "" };
}
