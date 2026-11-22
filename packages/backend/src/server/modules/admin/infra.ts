import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { redis, redisConfigured } from "@/server/core/rate-limit";
import { WORKER_STALE_MS } from "@/server/core/job-admin";
import { observabilityStatus } from "@/server/core/observability";
import { requireAnyPlatform } from "./access";
import { latestChecks } from "./health";
import { OBSERVE_PERMS } from "./releases";

/**
 * Infrastructure (stream E): only what the platform can measure itself. Postgres statistics via SQL (size, connections,
 * largest tables, pg_stat_statements when the extension is installed), Redis INFO (ONE command, cached 5 minutes per
 * process: Upstash bills per command), worker process memory / uptime / event-loop lag from the heartbeat, and queue
 * backlog from the latest stored health probe (no Redis call on page load). Host CPU, request rate, latency
 * percentiles and bandwidth have no in-app source and are reported as unavailable.
 */

const REDIS_INFO_TTL_MS = 5 * 60_000;
const DB_TTL_MS = 60_000;

const cache = globalThis as unknown as { realyRedisInfo?: { at: number; value: RedisInfo | null }; realyDbStats?: { at: number; value: DbStats } };

export interface RedisInfo {
  version: string | null;
  mode: string | null;
  uptimeSeconds: number | null;
  connectedClients: number | null;
  blockedClients: number | null;
  usedMemory: number | null;
  usedMemoryPeak: number | null;
  maxMemory: number | null;
  fragmentation: number | null;
  opsPerSecond: number | null;
  hits: number | null;
  misses: number | null;
  evictedKeys: number | null;
  keys: number | null;
  fetchedAt: Date;
}

export function parseRedisInfo(raw: string): Omit<RedisInfo, "fetchedAt"> {
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0 && !line.startsWith("#")) map.set(line.slice(0, i), line.slice(i + 1).trim());
  }
  const num = (k: string) => (map.has(k) && map.get(k) !== "" && Number.isFinite(Number(map.get(k))) ? Number(map.get(k)) : null);
  let keys: number | null = null;
  for (const [k, v] of map) if (/^db\d+$/.test(k)) keys = (keys ?? 0) + Number(/keys=(\d+)/.exec(v)?.[1] ?? 0);
  return {
    version: map.get("redis_version") ?? null,
    mode: map.get("redis_mode") ?? null,
    uptimeSeconds: num("uptime_in_seconds"),
    connectedClients: num("connected_clients"),
    blockedClients: num("blocked_clients"),
    usedMemory: num("used_memory"),
    usedMemoryPeak: num("used_memory_peak"),
    maxMemory: num("maxmemory") || null,
    fragmentation: num("mem_fragmentation_ratio"),
    opsPerSecond: num("instantaneous_ops_per_sec"),
    hits: num("keyspace_hits"),
    misses: num("keyspace_misses"),
    evictedKeys: num("evicted_keys"),
    keys,
  };
}

/** Redis INFO: one command, cached REDIS_INFO_TTL_MS. Null when Redis is not configured or unreachable. */
export async function redisInfo(force = false): Promise<RedisInfo | null> {
  if (!redisConfigured()) return null;
  const c = cache.realyRedisInfo;
  if (!force && c && Date.now() - c.at < REDIS_INFO_TTL_MS) return c.value;
  let value: RedisInfo | null = null;
  try {
    const raw = await Promise.race([redis().info(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2_500))]);
    value = { ...parseRedisInfo(raw), fetchedAt: new Date() };
  } catch {
    value = null;
  }
  cache.realyRedisInfo = { at: Date.now(), value };
  return value;
}

export interface DbStats {
  sizeBytes: number | null;
  version: string | null;
  connections: { state: string; n: number }[];
  maxConnections: number | null;
  tables: { name: string; totalBytes: number; rows: number }[];
  cacheHitRatio: number | null;
  deadlocks: number | null;
  statements: { query: string; calls: number; totalMs: number; meanMs: number }[] | null;
  fetchedAt: Date;
}

const truncateQuery = (q: string) => q.replace(/\s+/g, " ").replace(/'(?:[^']|'')*'/g, "'…'").slice(0, 240);

async function dbStats(force = false): Promise<DbStats> {
  const c = cache.realyDbStats;
  if (!force && c && Date.now() - c.at < DB_TTL_MS) return c.value;
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [size, version, conns, max, tables, hit, ext] = await Promise.all([
    safe(db().$queryRaw<{ size: bigint }[]>(Prisma.sql`SELECT pg_database_size(current_database())::bigint AS size`), []),
    safe(db().$queryRaw<{ v: string }[]>(Prisma.sql`SELECT current_setting('server_version') AS v`), []),
    safe(db().$queryRaw<{ state: string | null; n: bigint }[]>(Prisma.sql`SELECT COALESCE(state, 'background') AS state, COUNT(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1 ORDER BY 2 DESC`), []),
    safe(db().$queryRaw<{ m: number }[]>(Prisma.sql`SELECT current_setting('max_connections')::int AS m`), []),
    safe(
      db().$queryRaw<{ name: string; total: bigint; rows: number }[]>(Prisma.sql`
        SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS total, GREATEST(c.reltuples, 0)::float AS rows
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15`),
      [],
    ),
    safe(db().$queryRaw<{ ratio: number | null; deadlocks: bigint }[]>(Prisma.sql`SELECT (blks_hit::float / NULLIF(blks_hit + blks_read, 0)) AS ratio, deadlocks::bigint AS deadlocks FROM pg_stat_database WHERE datname = current_database()`), []),
    safe(db().$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM pg_extension WHERE extname = 'pg_stat_statements'`), []),
  ]);
  let statements: DbStats["statements"] = null;
  if (Number(ext[0]?.n ?? 0) > 0) {
    const rows = await safe(
      db().$queryRaw<{ query: string; calls: bigint; total: number; mean: number }[]>(Prisma.sql`
        SELECT query, calls::bigint AS calls, total_exec_time::float AS total, mean_exec_time::float AS mean
        FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY total_exec_time DESC LIMIT 10`),
      [],
    );
    statements = rows.map((r) => ({ query: truncateQuery(r.query), calls: Number(r.calls), totalMs: Math.round(r.total), meanMs: Math.round(r.mean * 100) / 100 }));
  }
  const value: DbStats = {
    sizeBytes: size[0] ? Number(size[0].size) : null,
    version: version[0]?.v ?? null,
    connections: conns.map((r) => ({ state: r.state ?? "background", n: Number(r.n) })),
    maxConnections: max[0]?.m ?? null,
    tables: tables.map((t) => ({ name: t.name, totalBytes: Number(t.total), rows: Math.round(t.rows) })),
    cacheHitRatio: hit[0]?.ratio ?? null,
    deadlocks: hit[0] ? Number(hit[0].deadlocks) : null,
    statements,
    fetchedAt: new Date(),
  };
  cache.realyDbStats = { at: Date.now(), value };
  return value;
}

export interface WorkerProcessInfo {
  id: string;
  hostname: string;
  pid: number;
  alive: boolean;
  startedAt: Date;
  lastSeenAt: Date;
  version: string | null;
  roles: string[];
  rssBytes: number | null;
  heapUsedBytes: number | null;
  uptimeSeconds: number | null;
  eventLoopLagMs: number | null;
  pausedQueues: string[];
}

/** Infra page data. `refresh` re-reads the Redis INFO and DB stats caches (still one INFO command). */
export async function infraOverview(ctx: RequestContext, opts: { refresh?: boolean } = {}) {
  await requireAnyPlatform(ctx, OBSERVE_PERMS);
  const [database, cacheInfo, heartbeats, checks] = await Promise.all([
    dbStats(opts.refresh),
    redisInfo(opts.refresh),
    db().platformHeartbeat.findMany({ where: { kind: "worker" }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    latestChecks(),
  ]);
  const workers: WorkerProcessInfo[] = heartbeats.map((h) => {
    const info = (h.info ?? {}) as { version?: string | null; roles?: string[]; process?: { rssBytes?: number; heapUsedBytes?: number; uptimeSeconds?: number; eventLoopLagMs?: number }; pausedQueues?: string[] };
    return {
      id: h.id,
      hostname: h.hostname,
      pid: h.pid,
      alive: Date.now() - h.lastSeenAt.getTime() < WORKER_STALE_MS,
      startedAt: h.startedAt,
      lastSeenAt: h.lastSeenAt,
      version: info.version ?? null,
      roles: info.roles ?? [],
      rssBytes: info.process?.rssBytes ?? null,
      heapUsedBytes: info.process?.heapUsedBytes ?? null,
      uptimeSeconds: info.process?.uptimeSeconds ?? null,
      eventLoopLagMs: info.process?.eventLoopLagMs ?? null,
      pausedQueues: info.pausedQueues ?? [],
    };
  });
  const q = checks.get("queues");
  const queues = (q?.detail as { queues?: { name: string; available: boolean; waiting: number; active: number; delayed: number; failed: number }[] } | null)?.queues ?? null;
  const obs = observabilityStatus();
  return {
    database,
    redis: { configured: redisConfigured(), info: cacheInfo, cacheTtlMs: REDIS_INFO_TTL_MS },
    workers,
    queues: queues ? { checkedAt: q!.checkedAt, list: queues } : null,
    observability: obs,
    /** Metrics with no in-app source. */
    unavailable: ["cpu", "hostMemory", "requestRate", "latencyP95", "bandwidth", "functionInvocations"],
  };
}
