import { cache } from "react";
import type { RequestContext } from "@/server/core/context";
import type { MetricDefinition, MetricRange, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { ALL_METRICS, metricByKey } from "./registry";
import { bucketsOf, changePct, previousRange } from "./range";

export const BI_DEPARTMENTS = ["executive", "sales", "marketing", "finance", "hr", "projects", "support", "operations", "ai"] as const;
export type BiDepartment = (typeof BI_DEPARTMENTS)[number];

const METRIC_TIMEOUT_MS = 10_000;

export interface MetricMeta {
  key: string;
  labelKey: string;
  department: BiDepartment;
  unit: MetricDefinition["unit"];
  kind: MetricDefinition["kind"];
  higherIsBetter: boolean | null;
  href: string | null;
}
export const metaOf = (m: MetricDefinition): MetricMeta => ({
  key: m.key,
  labelKey: m.labelKey,
  department: m.department,
  unit: m.unit,
  kind: m.kind,
  higherIsBetter: m.higherIsBetter ?? null,
  href: m.href ?? null,
});

export interface MetricValue extends MetricMeta {
  value: number | null;
  previous: number | null;
  changePct: number | null;
  /** -1 worse, 0 neutral, 1 better (by higherIsBetter). */
  trend: -1 | 0 | 1;
}

async function scopeFor(organizationId: string, companyId: string): Promise<MetricScope> {
  const c = await db().company.findFirst({ where: { id: companyId, organizationId }, select: { baseCurrency: true } });
  return { organizationId, companyId, currency: c?.baseCurrency ?? "USD" };
}

/** Context for metric reads: the company's chain, scope and the metrics the viewer may see. */
export async function metricContext(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "analytics.read", chain);
  const [scope, metrics] = await Promise.all([scopeFor(organizationId, companyId), visibleMetrics(ctx, chain)]);
  return { chain, scope, metrics };
}

/** Registry metrics the viewer holds the permission for (unknown permissions are treated as not held). */
export async function visibleMetrics(ctx: RequestContext, chain: ScopeChain): Promise<MetricDefinition[]> {
  const all = ALL_METRICS();
  const perms = [...new Set(all.map((m) => m.permission))];
  const allowed = new Set<string>();
  await Promise.all(
    perms.map(async (p) => {
      try {
        if (await can(ctx, p, chain)) allowed.add(p);
      } catch {
        /* unknown permission */
      }
    }),
  );
  return all.filter((m) => allowed.has(m.permission));
}

/**
 * Per-request memo of metric results. One Command Center render asks for the same metric and period from several
 * widgets (KPI ribbon, business health, CEO strip, company universe): ~45% of its ~800 queries were repeats.
 * React's cache() scopes the Map to the current server request; outside a request (worker) it is a fresh Map per
 * call, i.e. no memoization.
 */
const requestMetricMemo = cache(() => new Map<string, Promise<number | null>>());

/** Compute one metric; failures and timeouts become null (one broken module never breaks a dashboard). */
export function computeMetric(m: MetricDefinition, scope: MetricScope, range: MetricRange): Promise<number | null> {
  const memo = requestMetricMemo();
  const key = `${m.key}|${scope.organizationId}|${scope.companyId}|${scope.currency}|${range.from.getTime()}|${range.to.getTime()}`;
  let result = memo.get(key);
  if (!result) memo.set(key, (result = computeMetricUncached(m, scope, range)));
  return result;
}

async function computeMetricUncached(m: MetricDefinition, scope: MetricScope, range: MetricRange): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const v = await Promise.race([m.compute(scope, range), new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), METRIC_TIMEOUT_MS)))]);
    return typeof v === "bigint" ? Number(v) : Number.isFinite(v) ? v : null;
  } catch (err) {
    logger.warn({ metric: m.key, err: err instanceof Error ? err.message : String(err) }, "metric failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const trendOf = (m: MetricDefinition, change: number | null): -1 | 0 | 1 => {
  if (change === null || Math.abs(change) < 0.5 || m.higherIsBetter === undefined) return 0;
  return (change > 0) === m.higherIsBetter ? 1 : -1;
};

/** Values for the range and the previous period of equal length. */
export async function metricValues(metrics: MetricDefinition[], scope: MetricScope, range: MetricRange): Promise<MetricValue[]> {
  const prev = previousRange(range);
  return Promise.all(
    metrics.map(async (m) => {
      const [value, previous] = await Promise.all([computeMetric(m, scope, range), computeMetric(m, scope, prev)]);
      const change = value !== null && previous !== null ? changePct(value, previous) : null;
      return { ...metaOf(m), value, previous, changePct: change, trend: trendOf(m, change) };
    }),
  );
}

export interface SeriesPoint {
  from: string;
  to: string;
  value: number | null;
}

/** The metric computed for consecutive buckets of the range (trend chart). */
export async function metricSeries(m: MetricDefinition, scope: MetricScope, range: MetricRange, maxBuckets = 31): Promise<SeriesPoint[]> {
  const buckets = bucketsOf(range, maxBuckets);
  const values = await Promise.all(buckets.map((b) => computeMetric(m, scope, b)));
  return buckets.map((b, i) => ({ from: b.from.toISOString(), to: b.to.toISOString(), value: values[i]! }));
}

/** Resolve requested metric keys to visible definitions (unknown or forbidden keys are dropped). */
export function pickMetrics(visible: MetricDefinition[], keys: string[]) {
  const byKey = new Map(visible.map((m) => [m.key, m]));
  return keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
}

export const isKnownMetric = (key: string) => !!metricByKey(key);
