import type { MetricDefinition, MetricRange, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { redis, redisConfigured } from "@/server/core/rate-limit";
import { ALL_METRICS } from "./registry";
import { bucketsOf, previousRange, resolveRange } from "./range";
import { computeMetric, toMetricValue, type MetricValue, type SeriesPoint } from "./service";

/**
 * Per-company metric snapshots (Command Center query budget). One snapshot holds every registry metric for the last
 * 30 and 7 days plus their previous periods, and 13 weekly buckets (90 days) for the metrics worth charting or
 * forecasting. The worker refreshes the snapshots of companies someone looked at in the last day (bi.metric_snapshots,
 * every 10 minutes) and keeps them in Redis for 15 minutes; a page that finds none computes it live once and stores it,
 * so the next render reads one Redis key instead of ~750 queries. Values are the same real metric computations as the
 * live path (bi/service.ts computeMetric); only their timing differs, and every view shows when they were computed.
 * Permissions are applied when reading: the snapshot is server-side only and each viewer gets just the metrics they
 * may see. Without Redis everything is computed live, as before.
 */

const VERSION = 1;
const TTL_S = 15 * 60;
/** Older than this the worker recomputes it; a page still uses it until the TTL ends. */
export const SNAPSHOT_REFRESH_MS = 10 * 60_000;
/** Companies viewed within this window are kept warm by the worker. */
const WANTED_MS = 24 * 3_600_000;
const WANTED_KEY = "bi:snap:wanted";
const MAX_COMPANIES_PER_RUN = 200;
/** Parallel metric computations per snapshot (protects the database pool). */
const CONCURRENCY = 12;
export const SERIES_BUCKETS = 13;
const SERIES_CANDIDATES = 8;
const DAY = 86_400_000;

const keyOf = (organizationId: string, companyId: string) => `bi:snap:v${VERSION}:${organizationId}:${companyId}`;

export interface MetricSnapshot {
  v: number;
  computedAt: string;
  /** Exclusive end of the windows (tomorrow 00:00 UTC when computed); a snapshot from another day is ignored. */
  to: string;
  currency: string;
  /** key → [last 30d, previous 30d, last 7d, previous 7d]. */
  values: Record<string, [number | null, number | null, number | null, number | null]>;
  /** key → weekly buckets over the last 90 days (oldest first). */
  series: Record<string, SeriesPoint[]>;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The growth chart's metric: revenue when visible, else the first money flow, else the first flow metric. */
export function growthMetricOf(metrics: MetricDefinition[]): MetricDefinition | null {
  return metrics.find((m) => m.key === "finance.revenue") ?? metrics.find((m) => m.unit === "money" && m.kind === "flow") ?? metrics.find((m) => m.kind === "flow") ?? null;
}

/** Flow metrics worth forecasting: revenue first, then other money flows, then the busiest flow metrics. */
export function forecastCandidates(metrics: MetricDefinition[], values: Pick<MetricValue, "key" | "value">[], max = 4): MetricDefinition[] {
  const flows = metrics.filter((m) => m.kind === "flow" && m.higherIsBetter !== undefined);
  const valueOf = new Map(values.map((v) => [v.key, v.value ?? 0]));
  const rank = (m: MetricDefinition) => (m.key === "finance.revenue" ? 3 : 0) + (m.unit === "money" ? 2 : 0) + (m.department === "sales" ? 1 : 0);
  const ranked = [...flows].sort((a, b) => rank(b) - rank(a) || (valueOf.get(b.key) ?? 0) - (valueOf.get(a.key) ?? 0));
  return ranked.filter((m) => (valueOf.get(m.key) ?? 0) > 0).slice(0, max);
}

/** The 90-day range charted by the Command Center (13 weekly buckets; the last 12 are the forecast history). */
export const seriesRange = (now = new Date()): MetricRange => {
  const to = resolveRange("30d", undefined, undefined, now).to;
  return { from: new Date(to.getTime() - 90 * DAY), to };
};

async function companyScope(organizationId: string, companyId: string): Promise<MetricScope | null> {
  const c = await db().company.findFirst({ where: { id: companyId, organizationId, deletedAt: null }, select: { baseCurrency: true } });
  return c ? { organizationId, companyId, currency: c.baseCurrency } : null;
}

/** Compute a full snapshot from the live metric registry (no permission filter: it never leaves the server unfiltered). */
export async function computeSnapshot(scope: MetricScope, now = new Date()): Promise<MetricSnapshot> {
  const metrics = ALL_METRICS();
  const r30 = resolveRange("30d", undefined, undefined, now);
  const r7 = resolveRange("7d", undefined, undefined, now);
  const ranges = [r30, previousRange(r30), r7, previousRange(r7)];
  const jobs = metrics.flatMap((m) => ranges.map((r, i) => ({ m, r, i })));
  const results = await pool(jobs, CONCURRENCY, (j) => computeMetric(j.m, scope, j.r));
  const values: MetricSnapshot["values"] = {};
  jobs.forEach((j, n) => {
    const row = (values[j.m.key] ??= [null, null, null, null]);
    row[j.i] = results[n]!;
  });
  // Weekly history for the metrics a viewer could chart or forecast (top candidates over the whole registry).
  const v30 = metrics.map((m) => ({ key: m.key, value: values[m.key]?.[0] ?? null }));
  const charted = new Map<string, MetricDefinition>();
  for (const m of [growthMetricOf(metrics), metrics.find((x) => x.unit === "money" && x.kind === "flow"), ...forecastCandidates(metrics, v30, SERIES_CANDIDATES)]) if (m) charted.set(m.key, m);
  const buckets = bucketsOf(seriesRange(now), SERIES_BUCKETS);
  const seriesJobs = [...charted.values()].flatMap((m) => buckets.map((b) => ({ m, b })));
  const points = await pool(seriesJobs, CONCURRENCY, (j) => computeMetric(j.m, scope, j.b));
  const series: MetricSnapshot["series"] = {};
  seriesJobs.forEach((j, n) => (series[j.m.key] ??= []).push({ from: j.b.from.toISOString(), to: j.b.to.toISOString(), value: points[n]! }));
  return { v: VERSION, computedAt: now.toISOString(), to: r30.to.toISOString(), currency: scope.currency, values, series };
}

function parse(raw: string | null, now: Date): MetricSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as MetricSnapshot;
    if (s.v !== VERSION || s.to !== resolveRange("30d", undefined, undefined, now).to.toISOString()) return null;
    return s;
  } catch {
    return null;
  }
}

async function store(scope: MetricScope, snap: MetricSnapshot): Promise<void> {
  if (!redisConfigured()) return;
  await redis()
    .set(keyOf(scope.organizationId, scope.companyId), JSON.stringify(snap), "EX", TTL_S)
    .catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "metric snapshot not stored"));
}

/** Remember that someone looks at this company, so the worker keeps its snapshot warm. */
function markWanted(organizationId: string, companyId: string, now: number) {
  if (!redisConfigured()) return;
  void redis()
    .zadd(WANTED_KEY, now, `${organizationId}:${companyId}`)
    .catch(() => undefined);
}

/** Read the cached snapshot (null when missing, stale by day or Redis is unavailable). */
export async function cachedSnapshot(organizationId: string, companyId: string, now = new Date()): Promise<MetricSnapshot | null> {
  if (!redisConfigured()) return null;
  try {
    return parse(await redis().get(keyOf(organizationId, companyId)), now);
  } catch {
    return null;
  }
}

/**
 * The company's snapshot: cached when available, else computed live now and stored (the fallback is the same live
 * computation the page always did). `scope` must already be authorized by the caller.
 */
export async function companySnapshot(scope: MetricScope, opts: { viewed?: boolean; now?: Date } = {}): Promise<MetricSnapshot> {
  const now = opts.now ?? new Date();
  // Only people looking at the Command Center keep a company warm (not background readers such as the CEO loop).
  if (opts.viewed) markWanted(scope.organizationId, scope.companyId, now.getTime());
  const cached = await cachedSnapshot(scope.organizationId, scope.companyId, now);
  if (cached && cached.currency === scope.currency) return cached;
  const snap = await computeSnapshot(scope, now);
  await store(scope, snap);
  return snap;
}

const WINDOW = { "30d": 0, "7d": 2 } as const;

/** Metric values of one window from the snapshot (missing keys: computed live, so a new metric never shows as empty). */
export async function snapshotValues(snap: MetricSnapshot, scope: MetricScope, metrics: MetricDefinition[], window: keyof typeof WINDOW): Promise<MetricValue[]> {
  const i = WINDOW[window];
  return Promise.all(
    metrics.map(async (m) => {
      const row = snap.values[m.key];
      if (row) return toMetricValue(m, row[i]!, row[i + 1]!);
      const r = resolveRange(window);
      const [value, previous] = await Promise.all([computeMetric(m, scope, r), computeMetric(m, scope, previousRange(r))]);
      return toMetricValue(m, value, previous);
    }),
  );
}

/** Weekly 90-day series of one metric from the snapshot, computed live when the snapshot does not hold it. */
export async function snapshotSeries(snap: MetricSnapshot | null, scope: MetricScope, m: MetricDefinition): Promise<SeriesPoint[]> {
  const held = snap?.series[m.key];
  if (held?.length) return held;
  const buckets = bucketsOf(seriesRange(), SERIES_BUCKETS);
  const values = await Promise.all(buckets.map((b) => computeMetric(m, scope, b)));
  return buckets.map((b, i) => ({ from: b.from.toISOString(), to: b.to.toISOString(), value: values[i]! }));
}

/**
 * Worker job: refresh the snapshots of companies viewed in the last day whose snapshot is missing or older than the
 * refresh interval. Returns how many were recomputed.
 */
export async function refreshMetricSnapshots(now = new Date()): Promise<number> {
  if (!redisConfigured()) return 0;
  const r = redis();
  const since = now.getTime() - WANTED_MS;
  await r.zremrangebyscore(WANTED_KEY, 0, since).catch(() => undefined);
  const wanted = await r.zrevrangebyscore(WANTED_KEY, "+inf", since, "LIMIT", 0, MAX_COMPANIES_PER_RUN).catch(() => [] as string[]);
  let done = 0;
  for (const member of wanted) {
    const [organizationId, companyId] = member.split(":");
    if (!organizationId || !companyId) continue;
    try {
      const cached = await cachedSnapshot(organizationId, companyId, now);
      if (cached && now.getTime() - new Date(cached.computedAt).getTime() < SNAPSHOT_REFRESH_MS) continue;
      const scope = await companyScope(organizationId, companyId);
      if (!scope) {
        await r.zrem(WANTED_KEY, member).catch(() => undefined);
        continue;
      }
      await store(scope, await computeSnapshot(scope, now));
      done++;
    } catch (err) {
      logger.warn({ companyId, err: err instanceof Error ? err.message : String(err) }, "metric snapshot refresh failed");
    }
  }
  return done;
}

/** Drop a company's snapshot (tests, or after a currency change). */
export async function dropSnapshot(organizationId: string, companyId: string): Promise<void> {
  if (!redisConfigured()) return;
  await redis()
    .del(keyOf(organizationId, companyId))
    .catch(() => undefined);
}
