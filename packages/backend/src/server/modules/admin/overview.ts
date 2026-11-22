import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { redis, redisConfigured } from "@/server/core/rate-limit";
import { breakerSnapshot } from "@/server/modules/agents/router";
import { costMicros } from "@/server/modules/workforce/pricing";
import { capabilitiesFor, daysAgo, requireAnyPlatform, utcMonthStart } from "./access";
import { HEARTBEAT_STALE_MS, platformHealth, queueCounts } from "./monitoring";
import { requireConsoleUser } from "./preferences";

const LIVE_SUBSCRIPTION = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

/**
 * Monthly recurring revenue per currency, in minor units, from live subscription items (quantity × unit amount;
 * yearly items count 1/12). Only real subscription rows: no estimate when there are none.
 */
export async function mrrByCurrency() {
  const items = await db().subscriptionItem.findMany({
    where: { subscription: { status: { in: ["ACTIVE", "PAST_DUE"] } } },
    select: { quantity: true, unitAmountMinor: true, currency: true, subscription: { select: { interval: true } } },
  });
  const out = new Map<string, bigint>();
  for (const i of items) {
    const amount = i.unitAmountMinor * BigInt(i.quantity);
    const monthly = i.subscription.interval === "YEAR" ? amount / 12n : amount;
    out.set(i.currency, (out.get(i.currency) ?? 0n) + monthly);
  }
  return [...out].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1));
}

/** Tokens and estimated cost (micro-USD) of AI tasks since `since`, priced per model (workforce/pricing.ts). */
export async function aiUsageSince(since: Date, where: { organizationId?: string } = {}) {
  const rows = await db().agentTask.groupBy({
    by: ["model"],
    where: { ...where, startedAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  let input = 0;
  let output = 0;
  let micros = 0;
  for (const r of rows) {
    const i = r._sum.inputTokens ?? 0;
    const o = r._sum.outputTokens ?? 0;
    input += i;
    output += o;
    micros += costMicros(r.model, i, o);
  }
  return { inputTokens: input, outputTokens: output, tokens: input + output, costMicros: micros };
}

/** Every Overview number comes straight from the database (or Redis for queues). */
export async function platformOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.users.read", "platform.organizations.read", "platform.audit.read"]);
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);
  const h24 = daysAgo(1);
  const sessionActive = (since: Date) =>
    // Counted in SQL (B35): never loads every active session row.
    db()
      .$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT user_id)::bigint AS n FROM sessions WHERE last_seen_at >= ${since}`
      .then((r) => Number(r[0]?.n ?? 0));
  const [
    users,
    organizations,
    companies,
    active7,
    active30,
    new7,
    new30,
    subscriptions,
    trialing,
    mrr,
    employeesActive,
    employeesPaused,
    tasksRunning,
    tasksQueued,
    tasksFailed24,
    aiMonth,
    apiRequests30,
    pendingApprovals,
    health,
    queues,
    recentAdmin,
    suspendedOrgs,
  ] = await Promise.all([
    db().user.count({ where: { status: { not: "DELETED" } } }),
    db().organization.count(),
    db().company.count({ where: { deletedAt: null } }),
    sessionActive(d7),
    sessionActive(d30),
    db().user.count({ where: { createdAt: { gte: d7 } } }),
    db().user.count({ where: { createdAt: { gte: d30 } } }),
    db().subscription.count({ where: { status: { in: [...LIVE_SUBSCRIPTION] } } }),
    db().subscription.count({ where: { status: "TRIALING" } }),
    mrrByCurrency(),
    db().aiEmployee.count({ where: { archivedAt: null, status: "ACTIVE" } }),
    db().aiEmployee.count({ where: { archivedAt: null, status: "PAUSED" } }),
    db().agentTask.count({ where: { status: "RUNNING" } }),
    db().agentTask.count({ where: { status: "QUEUED" } }),
    db().agentTask.count({ where: { status: "FAILED", completedAt: { gte: h24 } } }),
    aiUsageSince(utcMonthStart()),
    db().usageRecord.aggregate({ where: { meter: "api.request", occurredAt: { gte: d30 } }, _sum: { quantity: true } }).then((r) => Number(r._sum.quantity ?? 0)),
    db().approval.count({ where: { status: "PENDING" } }),
    platformHealth(),
    queueCounts(),
    db().auditLog.findMany({ where: { category: { in: ["ADMIN", "SECURITY"] }, organizationId: null }, orderBy: { createdAt: "desc" }, take: 10 }),
    db().organization.count({ where: { status: "SUSPENDED" } }),
  ]);
  const actorIds = [...new Set(recentAdmin.map((a) => a.actorId).filter((x): x is string => !!x))];
  const actors = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } });
  return {
    users,
    organizations,
    companies,
    suspendedOrgs,
    active: { d7: active7, d30: active30 },
    registrations: { d7: new7, d30: new30 },
    subscriptions: { live: subscriptions, trialing },
    mrr,
    aiEmployees: { active: employeesActive, paused: employeesPaused },
    tasks: { running: tasksRunning, queued: tasksQueued, failed24h: tasksFailed24 },
    aiMonth,
    apiRequests30,
    pendingApprovals,
    health,
    queues,
    recentAdmin: recentAdmin.map((a) => ({ ...a, actorEmail: actors.find((u) => u.id === a.actorId)?.email ?? null })),
  };
}

// ───────────── Aggregate cache ─────────────

interface Cached<T> {
  value: T;
  computedAt: number;
}
const memory = new Map<string, { expires: number; entry: Promise<Cached<unknown>> }>();
const REDIS_PREFIX = "realy:admin:agg:";

/**
 * Cache for heavy, viewer-independent console aggregates (command center, action center). Order: this process's
 * memory (no Redis command at all), then Redis (one GET; shared by every admin instance), then compute once
 * (concurrent callers share the in-flight promise) and store in both. Redis TTL is twice the memory TTL, so a busy
 * console costs about one GET per key per instance per `ttlMs` and one SET per key per `2 × ttlMs` platform-wide.
 * Values must be JSON (no bigint). Never cache anything viewer-specific here: filter per viewer AFTER reading.
 */
export async function cachedAggregate<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<Cached<T> & { cache: "memory" | "redis" | "fresh" }> {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expires > now) return { ...((await hit.entry) as Cached<T>), cache: "memory" };
  let source: "redis" | "fresh" = "fresh";
  const entry = (async (): Promise<Cached<T>> => {
    if (redisConfigured()) {
      try {
        const raw = await redis().get(REDIS_PREFIX + key);
        if (raw) {
          const parsed = JSON.parse(raw) as Cached<T>;
          if (typeof parsed?.computedAt === "number" && Date.now() - parsed.computedAt < ttlMs * 2 && parsed.computedAt > (clearedAt.get(key) ?? clearedAt.get("*") ?? 0)) {
            source = "redis";
            return parsed;
          }
        }
      } catch (err) {
        logger.debug({ err: err instanceof Error ? err.message : String(err) }, "aggregate cache read skipped");
      }
    }
    const fresh: Cached<T> = { value: await compute(), computedAt: Date.now() };
    if (redisConfigured()) {
      redis()
        .set(REDIS_PREFIX + key, JSON.stringify(fresh), "PX", ttlMs * 2)
        .catch(() => undefined);
    }
    return fresh;
  })();
  memory.set(key, { expires: now + ttlMs, entry });
  try {
    const value = await entry;
    return { ...value, cache: source };
  } catch (err) {
    memory.delete(key); // never cache a failure
    throw err;
  }
}

/** When this process last cleared a key ("*": all): shared Redis entries computed before that are ignored here. */
const clearedAt = new Map<string, number>();

/**
 * Test seam / manual refresh: forget cached aggregates in this process. Redis entries expire on their own; this
 * process ignores the ones computed before the clear, so the next read computes fresh values.
 */
export function clearAggregateCache(key?: string) {
  const now = Date.now();
  if (key) {
    memory.delete(key);
    clearedAt.set(key, now);
  } else {
    memory.clear();
    clearedAt.clear();
    clearedAt.set("*", now);
  }
}

// ───────────── Command Center v2 ─────────────

export const RANGES = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000 } as const;
export type RangeKey = keyof typeof RANGES;
export const isRange = (v: unknown): v is RangeKey => typeof v === "string" && v in RANGES;

/**
 * One KPI. `value`/`previous` are real counts for the selected period and the one before it; `previous` is null when
 * the history does not exist (then `missing` names the source that would provide it). `status` "not_tracked" means
 * the metric itself has no source yet: the UI says so and links to the owning stream's page; it never shows 0.
 */
export interface Kpi {
  key: string;
  value: number | null;
  previous: number | null;
  format: "count" | "usdMicros" | "percent" | "money";
  /** Per-currency amounts (minor units as strings) for `format: "money"`. */
  money?: { currency: string; amountMinor: string }[];
  /** Locale-relative drill-down link. */
  href: string;
  /** Where the number comes from (shown on hover: "users.created_at"). */
  source: string;
  status: "ok" | "not_tracked" | "not_configured";
  /** What is missing for `previous` or for the metric (and which stream adds it). */
  missing?: { needs: string; stream: "A" | "B" | "C" | "D" | "E" | "F" };
  /** "up" is good (registrations), "down" is good (failures). Default "up". */
  better?: "up" | "down";
  /** Per-bucket series over the period (hours for 24h, days otherwise). */
  series?: number[];
}

export interface KpiSection {
  id: "users" | "organizations" | "revenue" | "subscriptions" | "ai" | "system";
  kpis: Kpi[];
}

export interface StatusStrip {
  health: { database: boolean; redis: boolean; email: boolean; ai: boolean; stripe: boolean };
  queues: { available: boolean; waiting: number; active: number; failed: number };
  workers: { total: number; alive: number };
  deadJobs: number;
  approvalsPending: number;
  approvalsOldestAt: string | null;
  breakersOpen: number;
  /** Stream E (platform_alerts, platform_incidents, error_groups); null when the read failed. */
  ops: { alertsOpen: number; alertsCritical: number; incidentsActive: number; incidentsMajor: number; errorsOpen: number } | null;
}

export interface CommandCenterData {
  range: RangeKey;
  from: string;
  to: string;
  buckets: string[];
  sections: KpiSection[];
  status: StatusStrip;
}

/** Who may see which KPI set (any one permission). The status strip follows the system set. */
export const SECTION_PERMS: Record<KpiSection["id"], readonly string[]> = {
  users: ["platform.users.read", "platform.support.read"],
  organizations: ["platform.organizations.read", "platform.support.read"],
  revenue: ["platform.subscriptions.read", "pricing.read"],
  subscriptions: ["platform.subscriptions.read", "pricing.read"],
  ai: ["platform.ai.read"],
  // Same as monitoring.ts MONITOR_PERMS (a literal: that module is in an import cycle with this one, so it must not
  // be read at load time).
  system: ["platform.security.read", "platform.organizations.read", "platform.controls.manage"],
};

type PairRow = { cur: bigint | null; prev: bigint | null };
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * Count rows of `table` whose `column` falls in the current period and in the previous one, in one query.
 * Identifiers come from the constant call sites below only (never from input).
 */
async function pair(table: string, column: string, from: Date, prevFrom: Date, where = Prisma.empty, distinct?: string): Promise<{ value: number; previous: number }> {
  const t = Prisma.raw(`"${table}"`);
  const c = Prisma.raw(`"${column}"`);
  const what = distinct ? Prisma.raw(`DISTINCT "${distinct}"`) : Prisma.raw("*");
  const rows = await db().$queryRaw<PairRow[]>(Prisma.sql`
    SELECT COUNT(${what}) FILTER (WHERE ${c} >= ${from})::bigint AS cur,
           COUNT(${what}) FILTER (WHERE ${c} < ${from})::bigint AS prev
    FROM ${t} WHERE ${c} >= ${prevFrom} ${where}`);
  return { value: num(rows[0]?.cur), previous: num(rows[0]?.prev) };
}

/** Bucket keys (ISO hour or day starts, UTC) from `from` to now. */
function bucketKeys(range: RangeKey, from: Date) {
  const hourly = range === "24h";
  const step = hourly ? 3_600_000 : 86_400_000;
  const start = new Date(from);
  if (hourly) start.setUTCMinutes(0, 0, 0);
  else start.setUTCHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let t = start.getTime(); t <= Date.now(); t += step) out.push(new Date(t).toISOString());
  return out;
}

async function series(range: RangeKey, buckets: string[], table: string, column: string, from: Date, where = Prisma.empty): Promise<number[]> {
  const unit = Prisma.raw(range === "24h" ? "'hour'" : "'day'");
  const t = Prisma.raw(`"${table}"`);
  const c = Prisma.raw(`"${column}"`);
  const rows = await db().$queryRaw<{ b: Date; n: bigint }[]>(Prisma.sql`
    SELECT date_trunc(${unit}, ${c} AT TIME ZONE 'UTC') AS b, COUNT(*)::bigint AS n FROM ${t} WHERE ${c} >= ${from} ${where} GROUP BY 1`);
  const m = new Map(rows.map((r) => [r.b.toISOString(), Number(r.n)]));
  // date_trunc(… AT TIME ZONE 'UTC') is a UTC wall-clock timestamp, read back as that UTC instant (as in ./trends).
  return buckets.map((k) => m.get(k) ?? 0);
}

const kpi = (k: Omit<Kpi, "status"> & { status?: Kpi["status"] }): Kpi => ({ status: "ok", ...k });
const notTracked = (key: string, href: string, needs: string, stream: NonNullable<Kpi["missing"]>["stream"], format: Kpi["format"] = "count"): Kpi => ({
  key,
  value: null,
  previous: null,
  format,
  href,
  source: needs,
  status: "not_tracked",
  missing: { needs, stream },
});

/**
 * Stream D snapshots: the value of daily metrics at the start of the period (the latest platform_daily_metrics row on
 * or before that UTC day, at most 2 days older). Missing keys mean no snapshot covers the period start yet.
 */
async function metricsAt(keys: string[], at: Date): Promise<Map<string, number>> {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const rows = await db().platformDailyMetric.findMany({
    where: { key: { in: keys }, day: { lte: day, gte: new Date(day.getTime() - 2 * 86_400_000) } },
    orderBy: { day: "desc" },
    select: { key: true, value: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) if (!out.has(r.key)) out.set(r.key, Number(r.value));
  return out;
}

/** Stream C: AI provider error rate (ERROR ÷ attempts, cached answers excluded) for the period and the previous one. */
async function aiErrorRatePair(from: Date, prevFrom: Date) {
  const rows = await db().$queryRaw<{ cur: boolean; total: bigint; errors: bigint }[]>(Prisma.sql`
    SELECT created_at >= ${from} AS cur, COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE status = 'ERROR')::bigint AS errors
    FROM ai_request_logs WHERE created_at >= ${prevFrom} AND status <> 'CACHED' GROUP BY 1`);
  const at = (cur: boolean) => rows.find((r) => r.cur === cur);
  const rate = (r: (typeof rows)[number] | undefined) => (r && num(r.total) ? (num(r.errors) / num(r.total)) * 100 : null);
  return { value: rate(at(true)), previous: rate(at(false)), attempts: num(at(true)?.total) };
}

/**
 * Stream E: share of health probes (service_health_checks) that were up, for the period and the previous one.
 * Not-configured and unknown probes are left out; maintenance counts as up.
 */
async function uptimePair(from: Date, prevFrom: Date) {
  const rows = await db().$queryRaw<{ cur: boolean; total: bigint; up: bigint }[]>(Prisma.sql`
    SELECT checked_at >= ${from} AS cur, COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE status IN ('OPERATIONAL', 'HEALTHY', 'MAINTENANCE'))::bigint AS up
    FROM service_health_checks WHERE checked_at >= ${prevFrom} AND status NOT IN ('NOT_CONFIGURED', 'UNKNOWN') GROUP BY 1`);
  const at = (cur: boolean) => rows.find((r) => r.cur === cur);
  const pct = (r: (typeof rows)[number] | undefined) => (r && num(r.total) ? (num(r.up) / num(r.total)) * 100 : null);
  return { value: pct(at(true)), previous: pct(at(false)) };
}

/** AI tokens and estimated cost (agent_tasks, priced per model) for the period and the previous one. */
async function aiSpendPair(from: Date, prevFrom: Date) {
  const rows = await db().$queryRaw<{ model: string | null; cur: boolean; input: bigint | null; output: bigint | null }[]>(Prisma.sql`
    SELECT model, started_at >= ${from} AS cur, SUM(input_tokens)::bigint AS input, SUM(output_tokens)::bigint AS output
    FROM agent_tasks WHERE started_at >= ${prevFrom} GROUP BY 1, 2`);
  const acc = { cur: { tokens: 0, micros: 0 }, prev: { tokens: 0, micros: 0 } };
  for (const r of rows) {
    const i = num(r.input);
    const o = num(r.output);
    const slot = r.cur ? acc.cur : acc.prev;
    slot.tokens += i + o;
    slot.micros += costMicros(r.model, i, o);
  }
  return acc;
}

/**
 * Compute every KPI set for a period (viewer-independent; cached by `commandCenter`). About 30 bounded queries plus
 * the queue counts and health checks, all in parallel. Periods compare [now - range, now) with the range before it.
 */
export async function computeCommandCenter(range: RangeKey): Promise<CommandCenterData> {
  const span = RANGES[range];
  const to = new Date();
  const from = new Date(to.getTime() - span);
  const prevFrom = new Date(from.getTime() - span);
  const buckets = bucketKeys(range, from);
  const sFrom = new Date(buckets[0]!);
  const active = (since: Date) => db().$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT user_id)::bigint AS n FROM sessions WHERE last_seen_at >= ${since}`.then((r) => num(r[0]?.n));
  const [
    totalUsers,
    newUsers,
    signIns,
    activeNow,
    usersSeries,
    signInSeries,
    orgCounts,
    newOrgs,
    orgSeries,
    mrr,
    subsByStatus,
    newSubs,
    canceledSubs,
    failedPay,
    trialsEnding,
    subsSeries,
    tasksCreated,
    tasksFailed,
    tasksCompleted,
    taskSeries,
    failSeries,
    spend,
    employees,
    approvals,
    health,
    queues,
    deadJobs,
    failedRuns,
    webhookFails,
    emailFails,
    beats,
    breakers,
    snapshotsAtStart,
    refunds,
    disputes,
    aiErrors,
    uptime,
    ops,
  ] = await Promise.all([
    db().user.count({ where: { status: { not: "DELETED" } } }),
    pair("users", "created_at", from, prevFrom),
    pair("sessions", "created_at", from, prevFrom, Prisma.empty, "user_id"),
    active(from),
    series(range, buckets, "users", "created_at", sFrom),
    db().$queryRaw<{ b: Date; n: bigint }[]>(Prisma.sql`
      SELECT date_trunc(${Prisma.raw(range === "24h" ? "'hour'" : "'day'")}, created_at AT TIME ZONE 'UTC') AS b, COUNT(DISTINCT user_id)::bigint AS n
      FROM sessions WHERE created_at >= ${sFrom} GROUP BY 1`),
    db().$queryRaw<{ orgs: bigint; suspended: bigint; companies: bigint }[]>`
      SELECT (SELECT COUNT(*) FROM organizations)::bigint AS orgs,
             (SELECT COUNT(*) FROM organizations WHERE status = 'SUSPENDED')::bigint AS suspended,
             (SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL)::bigint AS companies`,
    pair("organizations", "created_at", from, prevFrom),
    series(range, buckets, "organizations", "created_at", sFrom),
    mrrByCurrency(),
    db().subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    pair("subscriptions", "created_at", from, prevFrom),
    pair("subscriptions", "canceled_at", from, prevFrom),
    pair("subscriptions", "last_payment_failed_at", from, prevFrom),
    db().subscription.count({ where: { status: "TRIALING", trialEndsAt: { gte: to, lt: new Date(to.getTime() + 7 * 86_400_000) } } }),
    series(range, buckets, "subscriptions", "created_at", sFrom),
    pair("agent_tasks", "created_at", from, prevFrom),
    pair("agent_tasks", "completed_at", from, prevFrom, Prisma.sql`AND status = 'FAILED'`),
    pair("agent_tasks", "completed_at", from, prevFrom, Prisma.sql`AND status = 'COMPLETED'`),
    series(range, buckets, "agent_tasks", "created_at", sFrom),
    series(range, buckets, "agent_tasks", "completed_at", sFrom, Prisma.sql`AND status = 'FAILED'`),
    aiSpendPair(from, prevFrom),
    db().aiEmployee.groupBy({ by: ["status"], where: { archivedAt: null }, _count: { _all: true } }),
    db().approval.aggregate({ where: { status: "PENDING" }, _count: { _all: true }, _min: { createdAt: true } }),
    platformHealth(),
    queueCounts(),
    db().workerJobRun.count({ where: { status: "DEAD" } }),
    pair("worker_job_runs", "updated_at", from, prevFrom, Prisma.sql`AND status IN ('FAILED', 'DEAD')`),
    pair("integration_webhook_deliveries", "updated_at", from, prevFrom, Prisma.sql`AND status = 'FAILED'`),
    pair("email_messages", "created_at", from, prevFrom, Prisma.sql`AND status = 'FAILED'`),
    db().platformHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 20, select: { lastSeenAt: true } }).catch(() => []),
    breakerSnapshot().catch(() => null),
    metricsAt(["users.total", "orgs.total", "subscriptions.active", "subscriptions.trialing", "subscriptions.past_due"], from),
    pair("platform_refunds", "created_at", from, prevFrom),
    pair("platform_disputes", "created_at", from, prevFrom),
    aiErrorRatePair(from, prevFrom),
    uptimePair(from, prevFrom),
    import("./alerts").then((m) => m.opsStatusCounts()).catch(() => null),
  ]);

  const signInMap = new Map(signInSeries.map((r) => [r.b.toISOString(), num(r.n)]));
  const status = (s: string) => subsByStatus.find((r) => r.status === s)?._count._all ?? 0;
  const live = status("ACTIVE") + status("TRIALING") + status("PAST_DUE");
  const employeesBy = (s: string) => employees.find((r) => r.status === s)?._count._all ?? 0;
  const finished = { value: tasksFailed.value + tasksCompleted.value, previous: tasksFailed.previous + tasksCompleted.previous };
  const rate = (f: number, all: number) => (all ? (f / all) * 100 : null);
  const mrrMicro = mrr.map((m) => ({ currency: m.currency, amountMinor: m.amountMinor.toString() }));
  const arr = mrr.map((m) => ({ currency: m.currency, amountMinor: (m.amountMinor * 12n).toString() }));
  const upQueues = queues.filter((q) => q.available);
  const alive = beats.filter((b) => Date.now() - b.lastSeenAt.getTime() < HEARTBEAT_STALE_MS).length;
  const snap = (key: string, value: number, href: string, source: string, needs: string, stream: NonNullable<Kpi["missing"]>["stream"], extra: Partial<Kpi> = {}) =>
    kpi({ key, value, previous: null, format: "count", href, source, missing: { needs, stream }, ...extra });
  const DAILY = "platform_daily_metrics snapshots";
  /** Previous value from D's daily snapshot at the period start; without one, `previous` stays null and says why. */
  const fromSnapshot = (value: number, keys: string[]): Partial<Kpi> => {
    const vals = keys.map((k) => snapshotsAtStart.get(k));
    if (vals.some((v) => v === undefined)) return { missing: { needs: "platform_daily_metrics snapshot at period start", stream: "D" } };
    return { previous: vals.reduce<number>((a, v) => a + (v ?? 0), 0), missing: undefined };
  };

  const sections: KpiSection[] = [
    {
      id: "users",
      kpis: [
        snap("totalUsers", totalUsers, "/users", "users (not deleted); previous: platform_daily_metrics users.total", DAILY, "D", fromSnapshot(totalUsers, ["users.total"])),
        kpi({ key: "newUsers", ...newUsers, format: "count", href: `/users?created=${range === "24h" ? "7d" : range === "90d" ? "30d" : range}`, source: "users.created_at", series: usersSeries }),
        kpi({ key: "signIns", ...signIns, format: "count", href: "/security/access", source: "sessions.created_at (distinct users)", series: buckets.map((b) => signInMap.get(b) ?? 0) }),
        snap("activeUsers", activeNow, "/users?login=7d", "sessions.last_seen_at", DAILY, "D"),
      ],
    },
    {
      id: "organizations",
      kpis: [
        snap("totalOrgs", num(orgCounts[0]?.orgs), "/organizations", "organizations; previous: platform_daily_metrics orgs.total", DAILY, "D", fromSnapshot(num(orgCounts[0]?.orgs), ["orgs.total"])),
        kpi({ key: "newOrgs", ...newOrgs, format: "count", href: "/organizations", source: "organizations.created_at", series: orgSeries }),
        snap("suspendedOrgs", num(orgCounts[0]?.suspended), "/organizations?status=SUSPENDED", "organizations.status", "status history", "B", { better: "down" }),
        snap("companies", num(orgCounts[0]?.companies), "/organizations", "companies (not deleted)", DAILY, "D"),
      ],
    },
    {
      id: "revenue",
      kpis: [
        kpi({ key: "mrr", value: null, previous: null, format: "money", money: mrrMicro, href: "/revenue", source: "subscription_items (ACTIVE, PAST_DUE)", missing: { needs: "MRR snapshots", stream: "D" } }),
        kpi({ key: "arr", value: null, previous: null, format: "money", money: arr, href: "/revenue", source: "MRR × 12", missing: { needs: "MRR snapshots", stream: "D" } }),
        kpi({ key: "failedPayments", ...failedPay, format: "count", href: "/payments?status=failed", source: "subscriptions.last_payment_failed_at (latest attempt per subscription)", better: "down" }),
        kpi({ key: "refunds", value: refunds.value + disputes.value, previous: refunds.previous + disputes.previous, format: "count", href: "/payments/refunds", source: "platform_refunds + platform_disputes (created_at, Stripe mirror)", better: "down" }),
      ],
    },
    {
      id: "subscriptions",
      kpis: [
        snap("liveSubscriptions", live, "/subscriptions", "subscriptions (ACTIVE, TRIALING, PAST_DUE); previous: platform_daily_metrics", "subscription snapshots", "D", fromSnapshot(live, ["subscriptions.active", "subscriptions.trialing", "subscriptions.past_due"])),
        kpi({ key: "newSubscriptions", ...newSubs, format: "count", href: "/subscriptions", source: "subscriptions.created_at", series: subsSeries }),
        kpi({ key: "canceledSubscriptions", ...canceledSubs, format: "count", href: "/subscriptions?status=CANCELED", source: "subscriptions.canceled_at", better: "down" }),
        snap("pastDue", status("PAST_DUE") + status("UNPAID"), "/subscriptions?status=PAST_DUE", "subscriptions (PAST_DUE, UNPAID)", "subscription snapshots", "D", { better: "down" }),
        snap("trialsEnding", trialsEnding, "/subscriptions?status=TRIALING", "subscriptions.trial_ends_at (next 7 days)", "trial conversion snapshots", "D"),
      ],
    },
    {
      id: "ai",
      kpis: [
        kpi({ key: "tasksCreated", ...tasksCreated, format: "count", href: "/ai/tasks", source: "agent_tasks.created_at", series: taskSeries }),
        kpi({ key: "tasksFailed", ...tasksFailed, format: "count", href: "/ai/tasks?status=FAILED", source: "agent_tasks (FAILED, completed_at)", better: "down", series: failSeries }),
        kpi({ key: "failureRate", value: rate(tasksFailed.value, finished.value), previous: rate(tasksFailed.previous, finished.previous), format: "percent", href: "/ai/errors", source: "failed ÷ finished agent_tasks", better: "down" }),
        kpi({ key: "aiTokens", value: spend.cur.tokens, previous: spend.prev.tokens, format: "count", href: "/ai/usage", source: "agent_tasks input + output tokens" }),
        kpi({ key: "aiCost", value: spend.cur.micros, previous: spend.prev.micros, format: "usdMicros", href: "/ai/usage", source: "agent_tasks tokens × model list price (estimate)", better: "down" }),
        snap("employeesActive", employeesBy("ACTIVE"), "/ai/workforce?status=ACTIVE", "ai_employees (ACTIVE)", "workforce snapshots", "C"),
        aiErrors.attempts || aiErrors.previous !== null
          ? kpi({ key: "aiLatency", value: aiErrors.value, previous: aiErrors.previous, format: "percent", href: "/ai/requests?status=ERROR", source: "ai_request_logs: ERROR ÷ attempts (cached excluded)", better: "down" })
          : kpi({ key: "aiLatency", value: null, previous: null, format: "percent", href: "/ai/requests", source: "ai_request_logs", status: "not_configured", missing: { needs: "ai_request_logs rows (no AI calls in the period)", stream: "C" } }),
      ],
    },
    {
      id: "system",
      kpis: [
        snap("deadJobs", deadJobs, "/system/jobs?status=DEAD", "worker_job_runs (DEAD)", "dead-letter history", "E", { better: "down" }),
        kpi({ key: "failedJobs", ...failedRuns, format: "count", href: "/system/jobs?status=FAILED", source: "worker_job_runs (FAILED, DEAD)", better: "down" }),
        kpi({ key: "webhookFailures", ...webhookFails, format: "count", href: "/developers", source: "integration_webhook_deliveries (FAILED)", better: "down" }),
        kpi({ key: "emailFailures", ...emailFails, format: "count", href: "/email", source: "email_messages (FAILED)", better: "down" }),
        uptime.value !== null
          ? kpi({ key: "uptime", value: uptime.value, previous: uptime.previous, format: "percent", href: "/health", source: "service_health_checks: up ÷ probes (not configured excluded)" })
          : notTracked("uptime", "/health", "service_health_checks rows (ops.monitor worker job)", "E", "percent"),
        notTracked("latencyP95", "/infra", "OTEL / request telemetry backend", "E"),
      ],
    },
  ];

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    buckets,
    sections,
    status: {
      health,
      queues: {
        available: upQueues.length > 0,
        waiting: upQueues.reduce((a, q) => a + q.waiting + q.delayed, 0),
        active: upQueues.reduce((a, q) => a + q.active, 0),
        failed: upQueues.reduce((a, q) => a + q.failed, 0),
      },
      workers: { total: beats.length, alive },
      deadJobs,
      approvalsPending: approvals._count._all,
      approvalsOldestAt: approvals._min.createdAt?.toISOString() ?? null,
      breakersOpen: breakers ? breakers.filter((b) => b.open).length : 0,
      ops: ops ? { alertsOpen: ops["alerts.open"], alertsCritical: ops.alertsCritical, incidentsActive: ops["incidents.active"], incidentsMajor: ops.incidentsMajor, errorsOpen: ops.errorsOpen } : null,
    },
  };
}

/** Cache TTL of the command center (per range; see cachedAggregate). */
export const COMMAND_CENTER_TTL_MS = 30_000;

/**
 * The command center for one viewer: cached KPI sets for the period, each set kept only when the viewer holds one of
 * its permissions (SECTION_PERMS); the status strip only for monitoring roles. Requires a platform role.
 */
export async function commandCenter(ctx: RequestContext, range: RangeKey) {
  const keys = [...new Set(Object.values(SECTION_PERMS).flat())];
  const caps = await capabilitiesFor(ctx, keys);
  const allowed = (id: KpiSection["id"]) => SECTION_PERMS[id].some((p) => caps[p]);
  await requireConsoleUser(ctx);
  const { value, computedAt, cache } = await cachedAggregate(`cc:v3:${range}`, COMMAND_CENTER_TTL_MS, () => computeCommandCenter(range));
  return {
    ...value,
    sections: value.sections.filter((s) => allowed(s.id)),
    status: allowed("system") ? value.status : null,
    computedAt,
    cache,
  };
}

/** Top-bar health indicator: the live DB / Redis checks and configured services, cached 30 s (no per-page probes). */
export async function shellHealth() {
  const { value, computedAt } = await cachedAggregate("shell:health:v1", 30_000, () => platformHealth());
  return { ...value, computedAt };
}

/** Top-bar incident indicator (stream E counts, cached 30 s). Callers show it only to incident readers. */
export async function shellIncidents() {
  const { value } = await cachedAggregate("shell:incidents:v1", 30_000, async () => {
    const { opsStatusCounts } = await import("./alerts");
    const c = await opsStatusCounts();
    return { active: c["incidents.active"], major: c.incidentsMajor };
  });
  return value;
}

/** The last platform-level admin and security actions (10), for holders of platform.audit.read. */
export async function recentAdminActivity(ctx: RequestContext, take = 10) {
  await requireAnyPlatform(ctx, ["platform.audit.read", "platform.security.read"]);
  const rows = await db().auditLog.findMany({
    where: { category: { in: ["ADMIN", "SECURITY"] }, organizationId: null },
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 50),
    select: { id: true, action: true, category: true, reason: true, actorId: true, actorType: true, createdAt: true, resourceType: true, resourceId: true },
  });
  const ids = [...new Set(rows.map((a) => a.actorId).filter((x): x is string => !!x))];
  const actors = ids.length ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  return rows.map((a) => ({ ...a, actorEmail: actors.find((u) => u.id === a.actorId)?.email ?? null }));
}
