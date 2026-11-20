import "server-only";
import type { RequestContext } from "@/server/core/context";
import type { MetricDefinition } from "@/server/core/metrics";
import { criticalIssues, type Issue } from "./issues";
import { resolveRange } from "./range";
import { BI_DEPARTMENTS, metricContext, metricSeries, metricValues, type BiDepartment, type MetricValue } from "./service";

/**
 * Business health, deterministic and explainable (no AI): every KPI the viewer may see is scored from its change vs
 * the previous period (direction-aware), departments average their KPIs, and the company score is the weighted
 * department average minus a penalty per open critical issue. Forecasts are least-squares trend lines over real
 * weekly history, returned with their fit (r²) and always labelled as projections. Insights carry a plain-language
 * command so "Do this" can hand them to AI Command (a real plan + agent tasks).
 */

const WEIGHT: Record<BiDepartment, number> = { finance: 1.5, sales: 1.4, marketing: 1.1, executive: 1, projects: 1, support: 1, hr: 0.8, operations: 0.8, ai: 0.6 };
const MIN_SCORED = 3;
const PENALTY = { critical: 6, warning: 2 } as const;
const WEEK = 7 * 86_400_000;
const HISTORY_WEEKS = 12;
const PROJECT_WEEKS = 4;

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** A KPI's 0–100 score from its direction-aware change (50 = flat), or null when it cannot be judged. */
export function metricScore(v: Pick<MetricValue, "value" | "previous" | "changePct" | "higherIsBetter">): number | null {
  if (v.higherIsBetter === null || v.value === null || v.previous === null) return null;
  const sign = v.higherIsBetter ? 1 : -1;
  if (v.changePct === null) {
    // Previous period was zero.
    if (v.value === 0) return 50;
    return v.higherIsBetter ? 75 : 25;
  }
  return Math.round(clamp(50 + (sign * clamp(v.changePct, -100, 100)) / 2));
}

export interface DepartmentHealth {
  department: BiDepartment;
  score: number | null;
  scored: number;
  improving: number;
  declining: number;
  metrics: (MetricValue & { score: number | null })[];
}

export interface Forecast {
  key: string;
  labelKey: string;
  unit: MetricDefinition["unit"];
  higherIsBetter: boolean | null;
  history: { from: string; value: number | null }[];
  projection: { from: string; value: number }[];
  /** Change per week of the trend line (metric units). */
  slope: number;
  r2: number;
  /** Projected total of the next PROJECT_WEEKS weeks vs the last PROJECT_WEEKS actual weeks, in %. */
  projectedChangePct: number | null;
}

export type InsightKind = "metric_drop" | "metric_attention" | "overdue_work_tasks" | "overdue_follow_ups" | "approvals_expiring" | "ai_tasks_failed" | "ai_employee_over_budget" | "forecast_decline" | "department_weak";

export interface Insight {
  id: string;
  severity: "critical" | "warning" | "info";
  kind: InsightKind;
  params: Record<string, string | number>;
  href?: string;
  department?: BiDepartment;
}

/** Least squares y = a + b·x over the non-null points; null when fewer than `min` points. */
export function linearFit(values: (number | null)[], min = 6) {
  const pts = values.flatMap((y, x) => (y === null ? [] : [[x, y] as const]));
  if (pts.length < min) return null;
  const n = pts.length;
  const sx = pts.reduce((a, [x]) => a + x, 0);
  const sy = pts.reduce((a, [, y]) => a + y, 0);
  const sxx = pts.reduce((a, [x]) => a + x * x, 0);
  const sxy = pts.reduce((a, [x, y]) => a + x * y, 0);
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  const mean = sy / n;
  const ssTot = pts.reduce((acc, [, y]) => acc + (y - mean) ** 2, 0);
  const ssRes = pts.reduce((acc, [x, y]) => acc + (y - (a + b * x)) ** 2, 0);
  return { a, b, r2: ssTot === 0 ? 0 : clamp(1 - ssRes / ssTot, 0, 1) };
}

async function forecastOf(m: MetricDefinition, scope: Parameters<typeof metricSeries>[1]): Promise<Forecast | null> {
  const range = resolveRange("90d");
  const to = range.to;
  const from = new Date(to.getTime() - HISTORY_WEEKS * WEEK);
  const series = await metricSeries(m, scope, { from, to }, HISTORY_WEEKS);
  const values = series.map((p) => p.value);
  if (!values.some((v) => v !== null && v !== 0)) return null;
  const fit = linearFit(values);
  if (!fit) return null;
  const projection = Array.from({ length: PROJECT_WEEKS }, (_, i) => {
    const x = values.length + i;
    return { from: new Date(to.getTime() + i * WEEK).toISOString(), value: Math.max(0, fit.a + fit.b * x) };
  });
  const recent = values.slice(-PROJECT_WEEKS).reduce<number>((a, v) => a + (v ?? 0), 0);
  const ahead = projection.reduce((a, p) => a + p.value, 0);
  return {
    key: m.key,
    labelKey: m.labelKey,
    unit: m.unit,
    higherIsBetter: m.higherIsBetter ?? null,
    history: series.map((p) => ({ from: p.from, value: p.value })),
    projection,
    slope: fit.b,
    r2: fit.r2,
    projectedChangePct: recent === 0 ? null : ((ahead - recent) / Math.abs(recent)) * 100,
  };
}

/** Flow metrics worth forecasting: revenue first, then other money flows, then the busiest flow metrics. */
function forecastCandidates(metrics: MetricDefinition[], values: MetricValue[], max = 4) {
  const flows = metrics.filter((m) => m.kind === "flow" && m.higherIsBetter !== undefined);
  const valueOf = new Map(values.map((v) => [v.key, v.value ?? 0]));
  const ranked = [...flows].sort((a, b) => {
    const pa = (a.key === "finance.revenue" ? 3 : 0) + (a.unit === "money" ? 2 : 0) + (a.department === "sales" ? 1 : 0);
    const pb = (b.key === "finance.revenue" ? 3 : 0) + (b.unit === "money" ? 2 : 0) + (b.department === "sales" ? 1 : 0);
    return pb - pa || (valueOf.get(b.key) ?? 0) - (valueOf.get(a.key) ?? 0);
  });
  return ranked.filter((m) => (valueOf.get(m.key) ?? 0) > 0).slice(0, max);
}

export async function businessHealth(ctx: RequestContext, organizationId: string, companyId: string) {
  const { chain, scope, metrics } = await metricContext(ctx, organizationId, companyId);
  const values = await metricValues(metrics, scope, resolveRange("30d"));
  const week = await metricValues(metrics, scope, resolveRange("7d"));
  const [issues, forecasts] = await Promise.all([
    criticalIssues(ctx, chain, scope, metrics, week),
    Promise.all(forecastCandidates(metrics, values).map((m) => forecastOf(m, scope).catch(() => null))).then((f) => f.filter((x): x is Forecast => !!x)),
  ]);

  const departments: DepartmentHealth[] = BI_DEPARTMENTS.flatMap((d) => {
    const ms = values.filter((v) => v.department === d).map((v) => ({ ...v, score: metricScore(v) }));
    if (!ms.length) return [];
    const scored = ms.filter((m) => m.score !== null);
    return [
      {
        department: d,
        score: scored.length ? Math.round(scored.reduce((a, m) => a + m.score!, 0) / scored.length) : null,
        scored: scored.length,
        improving: ms.filter((m) => m.trend === 1).length,
        declining: ms.filter((m) => m.trend === -1).length,
        metrics: ms,
      },
    ];
  });
  const scoredMetrics = departments.reduce((a, d) => a + d.scored, 0);
  const weighted = departments.filter((d) => d.score !== null);
  const base = weighted.length ? weighted.reduce((a, d) => a + d.score! * WEIGHT[d.department], 0) / weighted.reduce((a, d) => a + WEIGHT[d.department], 0) : null;
  const penalty = issues.reduce((a, i) => a + PENALTY[i.severity], 0);
  const score = base === null || scoredMetrics < MIN_SCORED ? null : Math.round(clamp(base - penalty));

  const insights: Insight[] = issues.map((i: Issue, n) => ({
    id: `issue-${n}`,
    severity: i.severity,
    kind: i.kind,
    params: i.params,
    href: i.href,
    department: i.metricKey ? values.find((v) => v.key === i.metricKey)?.department : undefined,
  }));
  for (const f of forecasts) {
    if (f.r2 >= 0.3 && f.projectedChangePct !== null && f.higherIsBetter !== null && (f.higherIsBetter ? f.projectedChangePct <= -10 : f.projectedChangePct >= 10)) {
      insights.push({ id: `forecast-${f.key}`, severity: "warning", kind: "forecast_decline", params: { metric: f.labelKey, change: Math.round(f.projectedChangePct) }, href: metrics.find((m) => m.key === f.key)?.href });
    }
  }
  for (const d of departments) {
    if (d.score !== null && d.score < 40 && d.scored >= 2) insights.push({ id: `dept-${d.department}`, severity: "warning", kind: "department_weak", params: { department: d.department, score: d.score }, department: d.department });
  }
  const order = { critical: 0, warning: 1, info: 2 } as const;
  insights.sort((a, b) => order[a.severity] - order[b.severity]);

  return { currency: scope.currency, score, base: base === null ? null : Math.round(base), penalty, scoredMetrics, departments, forecasts, insights, issues: issues.length };
}
export type BusinessHealth = Awaited<ReturnType<typeof businessHealth>>;
