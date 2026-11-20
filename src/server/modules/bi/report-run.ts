import type { RequestContext } from "@/server/core/context";
import { englishT } from "./labels";
import { getReport } from "./dashboards";
import { resolveRange, bucketsOf, previousRange, changePct, isoDay, type RangeKey } from "./range";
import { computeMetric, metaOf, metricContext, pickMetrics, type MetricMeta } from "./service";

export interface ReportResult {
  report: Awaited<ReturnType<typeof getReport>>;
  range: { from: Date; to: Date };
  metrics: MetricMeta[];
  currency: string;
  /** Totals: one row per metric. */
  totals: { key: string; value: number | null; previous: number | null; changePct: number | null }[];
  /** Bucketed: one row per bucket, values aligned with `metrics`. */
  buckets: { from: Date; to: Date; values: (number | null)[] }[] | null;
  /** Metrics in the definition the viewer cannot see (or no longer exist). */
  hidden: number;
}

export async function runReport(ctx: RequestContext, organizationId: string, companyId: string, reportId: string): Promise<ReportResult> {
  const report = await getReport(ctx, organizationId, companyId, reportId);
  const { scope, metrics: visible } = await metricContext(ctx, organizationId, companyId);
  const metrics = pickMetrics(visible, report.metricKeys);
  const range = resolveRange(report.range as RangeKey, report.customFrom ? isoDay(report.customFrom) : undefined, report.customTo ? isoDay(new Date(report.customTo)) : undefined);
  const prev = previousRange(range);
  const totals = await Promise.all(
    metrics.map(async (m) => {
      const [value, previous] = await Promise.all([computeMetric(m, scope, range), computeMetric(m, scope, prev)]);
      return { key: m.key, value, previous, changePct: value !== null && previous !== null ? changePct(value, previous) : null };
    }),
  );
  let buckets: ReportResult["buckets"] = null;
  if (report.bucketed) {
    const bs = bucketsOf(range, 31);
    buckets = await Promise.all(bs.map(async (b) => ({ from: b.from, to: b.to, values: await Promise.all(metrics.map((m) => computeMetric(m, scope, b))) })));
  }
  return { report, range, metrics: metrics.map(metaOf), currency: scope.currency, totals, buckets, hidden: report.metricKeys.length - metrics.length };
}

const csvCell = (v: string | number | null) => {
  if (v === null) return "";
  const s = String(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** Money minor units → major units string for CSV. */
const plain = (m: MetricMeta, v: number | null) => (v === null ? null : m.unit === "money" ? (v / 100).toFixed(2) : Number.isInteger(v) ? v : Number(v.toFixed(4)));

export function reportCsv(r: ReportResult): string {
  const label = (m: MetricMeta) => `${englishT(m.labelKey)}${m.unit === "money" ? ` (${r.currency})` : ""}`;
  const lines: (string | number | null)[][] = [];
  if (r.buckets) {
    lines.push(["from", "to", ...r.metrics.map(label)]);
    for (const b of r.buckets) lines.push([isoDay(b.from), isoDay(new Date(b.to.getTime() - 1)), ...b.values.map((v, i) => plain(r.metrics[i]!, v))]);
  } else {
    lines.push(["metric", "key", "value", "previous", "change_pct"]);
    for (const [i, t] of r.totals.entries()) {
      const m = r.metrics[i]!;
      lines.push([label(m), m.key, plain(m, t.value), plain(m, t.previous), t.changePct === null ? null : Number(t.changePct.toFixed(1))]);
    }
  }
  return lines.map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}
