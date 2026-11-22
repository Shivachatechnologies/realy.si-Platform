import { z } from "zod";
import { db, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { sha256 } from "@/server/core/crypto";
import { logger } from "@/server/core/logger";
import { daysAgo, requireAnyPlatform } from "./access";

/**
 * API request logs and rate-limit (429) events (Admin → API logs, stream F).
 *
 * Writes: `recordApiRequest` is the cheap, sampled writer for `api_request_logs` (every non-2xx plus 10% of 2xx,
 * fire-and-forget, IP hashed, never bodies or headers). It is meant to be registered on the `CORE/http.ts`
 * request-complete hook that stream E owns; until that hook exists nothing calls it and the explorer says so.
 * `rate_limit_events` are written by `CORE/rate-limit.ts` itself (one row per refused rule, subject and window).
 * Both tables are kept 14 days (opportunistic purge on write, plus `purgeApiLogs` for a scheduled job).
 */

const READ = ["platform.security.read", "platform.logs.read", "platform.organizations.read", "platform.controls.manage"];
export const API_LOG_RETENTION_DAYS = 14;
/** Share of successful (2xx/3xx) requests that are stored; every error is stored. */
export const SUCCESS_SAMPLE_RATE = 0.1;

export interface ApiRequestEntry {
  app: "user" | "admin";
  method: string;
  route: string;
  status: number;
  durationMs: number;
  requestId: string;
  organizationId?: string | null;
  apiKeyId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  errorCode?: string | null;
}

/** Sampling decision (exported for tests): all errors, SUCCESS_SAMPLE_RATE of the rest. */
export const shouldSample = (status: number, rand = Math.random()) => status >= 400 || rand < SUCCESS_SAMPLE_RATE;

const uuidOrNull = (v: string | null | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** Record one API request (sampled). Never throws and never awaits the insert on the request path. */
export function recordApiRequest(e: ApiRequestEntry, rand = Math.random()): boolean {
  if (!shouldSample(e.status, rand)) return false;
  try {
    void db()
      .apiRequestLog.create({
        data: {
          app: e.app,
          method: e.method.slice(0, 10),
          route: e.route.slice(0, 200),
          status: e.status,
          durationMs: Math.max(0, Math.round(e.durationMs)),
          requestId: e.requestId.slice(0, 100),
          organizationId: uuidOrNull(e.organizationId),
          apiKeyId: uuidOrNull(e.apiKeyId),
          ipHash: e.ip ? sha256(`ip:${e.ip}`).slice(0, 24) : null,
          userAgent: e.userAgent?.slice(0, 200) ?? null,
          errorCode: e.errorCode?.slice(0, 80) ?? null,
        },
      })
      .then(() => (Math.random() < 0.005 ? purgeApiLogs() : null))
      .catch((err: unknown) => logger.debug({ err: (err as Error).message }, "api request log not recorded"));
  } catch {
    return false;
  }
  return true;
}

/** Delete API request logs and rate-limit events older than the retention window. */
export async function purgeApiLogs(now = Date.now()) {
  const before = new Date(now - API_LOG_RETENTION_DAYS * 86_400_000);
  const [logs, events] = await Promise.all([db().apiRequestLog.deleteMany({ where: { createdAt: { lt: before } } }), db().rateLimitEvent.deleteMany({ where: { createdAt: { lt: before } } })]);
  return { logs: logs.count, events: events.count };
}

const logFilters = z.object({
  org: z.string().uuid().optional().catch(undefined),
  key: z.string().uuid().optional().catch(undefined),
  route: z.string().trim().max(200).optional().catch(undefined),
  status: z.enum(["2xx", "3xx", "4xx", "5xx", "429"]).optional().catch(undefined),
  app: z.enum(["user", "admin"]).optional().catch(undefined),
  requestId: z.string().trim().max(100).optional().catch(undefined),
  range: z.enum(["1h", "24h", "7d", "14d"]).default("24h").catch("24h"),
  limit: z.coerce.number().int().min(10).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type ApiLogFilters = Partial<Record<keyof z.input<typeof logFilters>, unknown>>;

const RANGE_MS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "14d": 14 * 86_400_000 } as const;

function statusWhere(s: z.infer<typeof logFilters>["status"]): Prisma.IntFilter | undefined {
  if (!s) return undefined;
  if (s === "429") return { equals: 429 };
  const base = Number(s[0]) * 100;
  return { gte: base, lt: base + 100 };
}

/** Keyset-paginated API request log with filters (organization, key, route, status class, app, request id, range). */
export async function searchApiLogs(ctx: RequestContext, raw: ApiLogFilters = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = logFilters.parse(raw);
  const since = new Date(Date.now() - RANGE_MS[f.range]);
  const where: Prisma.ApiRequestLogWhereInput = {
    createdAt: { gte: since },
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.key ? { apiKeyId: f.key } : {}),
    ...(f.route ? { route: { contains: f.route, mode: "insensitive" } } : {}),
    ...(f.app ? { app: f.app } : {}),
    ...(f.requestId ? { requestId: f.requestId } : {}),
    ...(f.status ? { status: statusWhere(f.status) } : {}),
  };
  const rows = await db().apiRequestLog.findMany({ where, orderBy: { id: "desc" }, take: f.limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) });
  const hasMore = rows.length > f.limit;
  const data = hasMore ? rows.slice(0, f.limit) : rows;
  const orgIds = [...new Set(data.map((r) => r.organizationId).filter((x): x is string => !!x))];
  const orgs = orgIds.length ? await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  return {
    filters: f,
    data: data.map((r) => ({ ...r, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? null })),
    nextCursor: hasMore ? data[data.length - 1]!.id : null,
  };
}

/** Aggregates over the window: totals by status class, top routes, p50/p95 latency (of the stored sample). */
export async function apiLogSummary(ctx: RequestContext, raw: { range?: unknown } = {}) {
  await requireAnyPlatform(ctx, READ);
  const range = logFilters.shape.range.parse(raw.range);
  const since = new Date(Date.now() - RANGE_MS[range]);
  const [byStatus, routes, latency, total, oldest] = await Promise.all([
    db().$queryRaw<{ cls: number; n: bigint }[]>`SELECT (status / 100)::int AS cls, count(*)::bigint AS n FROM api_request_logs WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`,
    db().$queryRaw<{ route: string; n: bigint; errors: bigint; p95: number | null }[]>`
      SELECT route, count(*)::bigint AS n, count(*) FILTER (WHERE status >= 500)::bigint AS errors,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
      FROM api_request_logs WHERE created_at >= ${since} GROUP BY route ORDER BY n DESC LIMIT 15`,
    db().$queryRaw<{ p50: number | null; p95: number | null }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
      FROM api_request_logs WHERE created_at >= ${since}`,
    db().apiRequestLog.count({ where: { createdAt: { gte: since } } }),
    db().apiRequestLog.findFirst({ orderBy: { id: "asc" }, select: { createdAt: true } }),
  ]);
  return {
    range,
    total,
    tracking: !!oldest,
    oldestAt: oldest?.createdAt ?? null,
    byStatus: byStatus.map((b) => ({ cls: `${b.cls}xx`, count: Number(b.n) })),
    routes: routes.map((r) => ({ route: r.route, count: Number(r.n), errors: Number(r.errors), p95: r.p95 === null ? null : Math.round(r.p95) })),
    p50: latency[0]?.p50 == null ? null : Math.round(latency[0].p50),
    p95: latency[0]?.p95 == null ? null : Math.round(latency[0].p95),
    sampleRate: SUCCESS_SAMPLE_RATE,
  };
}

/** Rate-limit (429) events of the last `days` days: by rule and the latest rows. */
export async function rateLimitSummary(ctx: RequestContext, days = 7) {
  await requireAnyPlatform(ctx, READ);
  const since = daysAgo(Math.min(Math.max(days, 1), API_LOG_RETENTION_DAYS));
  const [byRule, latest, total] = await Promise.all([
    db().rateLimitEvent.groupBy({ by: ["rule"], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { rule: "desc" } }, take: 20 }),
    db().rateLimitEvent.findMany({ where: { createdAt: { gte: since } }, orderBy: { id: "desc" }, take: 30 }),
    db().rateLimitEvent.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { days, total, byRule: byRule.map((r) => ({ rule: r.rule, count: r._count._all })), latest };
}
