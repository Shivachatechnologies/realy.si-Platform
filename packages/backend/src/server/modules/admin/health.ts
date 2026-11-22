import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls } from "@/server/core/platform-controls";
import { redis, redisConfigured } from "@/server/core/rate-limit";
import { queueDepths, WORKER_STALE_MS } from "@/server/core/job-admin";
import { workerConfigured } from "@/server/core/jobs";
import { observabilityStatus } from "@/server/core/observability";
import { emailConfigured } from "@/server/modules/email/service";
import { billingConfigured } from "@/server/modules/billing/stripe-billing";
import { oauthCredentials } from "@/server/modules/auth/oauth";
import { AI_PROVIDERS, providerKeyConfigured, type AiProviderKey } from "@/server/modules/agents/providers/catalog";
import { requireAnyPlatform } from "./access";
import { OBSERVE_PERMS } from "./releases";

/**
 * Health center (stream E). A low-frequency probe job (`ops.monitor`, every 5 min in the worker) checks each service
 * and stores one `service_health_checks` row per probe; uptime, history and "last check" are computed from those rows
 * only. Internal services are probed every tick; services that call a third-party API (AI providers, email, Stripe)
 * and the Redis-backed queue depths every 15 min, to keep provider calls and Redis commands low. Nothing is simulated:
 * a service without credentials is NOT_CONFIGURED, a service without data is UNKNOWN.
 */

export const HEALTH_READ = OBSERVE_PERMS;

export const HEALTH_STATUSES = ["OPERATIONAL", "HEALTHY", "DEGRADED", "CRITICAL", "DOWN", "MAINTENANCE", "UNKNOWN", "NOT_CONFIGURED"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** Worst first: used for roll-ups and hourly strips. */
const RANK: Record<HealthStatus, number> = { DOWN: 7, CRITICAL: 6, DEGRADED: 5, MAINTENANCE: 4, UNKNOWN: 3, NOT_CONFIGURED: 1, OPERATIONAL: 0, HEALTHY: 0 };
export const worstStatus = (list: HealthStatus[]): HealthStatus => list.reduce<HealthStatus>((w, s) => (RANK[s] > RANK[w] ? s : w), "HEALTHY");

/** Statuses that count as "up" for uptime (DEGRADED still serves traffic). UNKNOWN/NOT_CONFIGURED/MAINTENANCE are excluded. */
const UP: HealthStatus[] = ["HEALTHY", "OPERATIONAL", "DEGRADED"];
const MEASURED: HealthStatus[] = ["HEALTHY", "OPERATIONAL", "DEGRADED", "CRITICAL", "DOWN"];

const MIN = 60_000;

export interface ServiceDef {
  key: string;
  group: "apps" | "data" | "background" | "ai" | "providers" | "integrations";
  /** Services this one needs (shown as dependencies). */
  deps: string[];
  /** Probe at most this often. */
  everyMs: number;
  /** Core services open an incident automatically when they stay DOWN (alerts.ts). */
  core?: boolean;
}

export const HEALTH_SERVICES: readonly ServiceDef[] = [
  { key: "web", group: "apps", deps: ["db", "redis", "auth"], everyMs: 5 * MIN, core: true },
  { key: "admin", group: "apps", deps: ["db", "auth"], everyMs: 5 * MIN },
  { key: "api", group: "apps", deps: ["db", "redis"], everyMs: 5 * MIN, core: true },
  { key: "auth", group: "apps", deps: ["db", "email", "oauth"], everyMs: 5 * MIN },
  { key: "db", group: "data", deps: [], everyMs: 5 * MIN, core: true },
  { key: "db.connections", group: "data", deps: ["db"], everyMs: 5 * MIN },
  { key: "redis", group: "data", deps: [], everyMs: 5 * MIN },
  { key: "workers", group: "background", deps: ["db", "redis"], everyMs: 5 * MIN, core: true },
  { key: "queues", group: "background", deps: ["redis", "workers"], everyMs: 15 * MIN },
  { key: "ai.anthropic", group: "ai", deps: [], everyMs: 15 * MIN },
  { key: "ai.openai", group: "ai", deps: [], everyMs: 15 * MIN },
  { key: "ai.gemini", group: "ai", deps: [], everyMs: 15 * MIN },
  { key: "email", group: "providers", deps: [], everyMs: 15 * MIN },
  { key: "payments", group: "providers", deps: ["webhooks"], everyMs: 15 * MIN },
  { key: "storage", group: "providers", deps: ["db"], everyMs: 5 * MIN },
  { key: "telephony", group: "providers", deps: ["integrations"], everyMs: 5 * MIN },
  { key: "webhooks", group: "integrations", deps: ["workers", "queues"], everyMs: 5 * MIN },
  { key: "oauth", group: "integrations", deps: [], everyMs: 5 * MIN },
  { key: "integrations", group: "integrations", deps: ["workers"], everyMs: 5 * MIN },
];

export const HEALTH_SERVICE_KEYS = HEALTH_SERVICES.map((s) => s.key);
export const serviceDef = (key: string) => HEALTH_SERVICES.find((s) => s.key === key);

export interface ProbeResult {
  status: HealthStatus;
  latencyMs?: number | null;
  detail?: Record<string, unknown>;
}

// ───────────── Probes ─────────────

const PROBE_TIMEOUT_MS = 5_000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

/** GET a URL; the body is never read or stored (provider answers may carry account data). */
async function httpProbe(url: string, headers: Record<string, string> = {}): Promise<{ status: number | null; ms: number; error?: string }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "manual", cache: "no-store" });
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { status: null, ms: Math.round(performance.now() - t0), error: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

/** Status of a provider API answer: 2xx healthy (slow = degraded), 401/403 credentials rejected, 429 throttled, else down. */
function providerStatus(r: { status: number | null; ms: number }, slowMs = 2_500): HealthStatus {
  if (r.status === null) return "DOWN";
  if (r.status >= 200 && r.status < 300) return r.ms > slowMs ? "DEGRADED" : "HEALTHY";
  if (r.status === 429) return "DEGRADED";
  return "DOWN";
}

const ratio = (bad: number, total: number) => (total > 0 ? bad / total : 0);

/** Failure-ratio status for traffic-derived services (no live probe): needs at least `min` events to judge. */
function trafficStatus(bad: number, total: number, min = 10): HealthStatus {
  if (total < min) return "OPERATIONAL";
  const r = ratio(bad, total);
  return r >= 0.5 ? "CRITICAL" : r >= 0.15 ? "DEGRADED" : "OPERATIONAL";
}

const since = (ms: number) => new Date(Date.now() - ms);

async function probeSelf(url: string | undefined, maintenance: boolean, path = "/api/health"): Promise<ProbeResult> {
  if (!url) return { status: "NOT_CONFIGURED", detail: { reason: "url_not_set" } };
  let target: string;
  try {
    target = new URL(path, url).toString();
  } catch {
    return { status: "NOT_CONFIGURED", detail: { reason: "invalid_url" } };
  }
  const r = await httpProbe(target);
  const base = providerStatus(r, 1_500);
  const status: HealthStatus = maintenance && base !== "DOWN" ? "MAINTENANCE" : base === "HEALTHY" && r.status !== 200 ? "DEGRADED" : base;
  return { status, latencyMs: r.ms, detail: { http: r.status, error: r.error ?? null, path, live: true } };
}

async function probeApi(maintenance: boolean): Promise<ProbeResult> {
  const live = await probeSelf(env().APP_URL, maintenance, "/api/health/ready");
  // Unexpected API errors captured by the onError hook in the last 15 minutes.
  const errors = await db().errorEvent.count({ where: { createdAt: { gte: since(15 * MIN) }, statusCode: { gte: 500 } } }).catch(() => null);
  let status = live.status;
  if (status === "HEALTHY" && errors !== null && errors >= 50) status = "DEGRADED";
  return { ...live, status, detail: { ...live.detail, serverErrors15m: errors } };
}

async function probeAuth(): Promise<ProbeResult> {
  const rows = await db().auditLog.groupBy({ by: ["action"], where: { category: "SECURITY", createdAt: { gte: since(15 * MIN) }, action: { in: ["auth.sign_in", "auth.sign_in_mfa_pending", "auth.sign_in_failed"] } }, _count: { _all: true } });
  const n = (a: string) => rows.find((r) => r.action === a)?._count._all ?? 0;
  const ok = n("auth.sign_in") + n("auth.sign_in_mfa_pending");
  const failed = n("auth.sign_in_failed");
  // Wrong passwords are normal; only a very high failure share over real volume says sign-in is broken.
  const total = ok + failed;
  const status: HealthStatus = total >= 20 && ratio(failed, total) >= 0.9 ? "DEGRADED" : "OPERATIONAL";
  return { status, detail: { signIns15m: ok, failures15m: failed } };
}

async function probeDb(): Promise<ProbeResult> {
  try {
    const { ms } = await timed(() => db().$queryRaw`SELECT 1`);
    return { status: ms > 500 ? "DEGRADED" : "HEALTHY", latencyMs: ms, detail: { live: true } };
  } catch {
    return { status: "DOWN", detail: { error: "unreachable", live: true } };
  }
}

async function probeDbConnections(): Promise<ProbeResult> {
  try {
    const [row] = await db().$queryRaw<{ used: bigint; max: number; active: bigint; idle_tx: bigint }[]>(Prisma.sql`
      SELECT (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::bigint AS used,
             current_setting('max_connections')::int AS max,
             (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active')::bigint AS active,
             (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction')::bigint AS idle_tx`);
    const used = Number(row?.used ?? 0);
    const max = Number(row?.max ?? 0);
    const r = ratio(used, max);
    return { status: r >= 0.95 ? "CRITICAL" : r >= 0.8 ? "DEGRADED" : "HEALTHY", detail: { used, max, active: Number(row?.active ?? 0), idleInTransaction: Number(row?.idle_tx ?? 0) } };
  } catch {
    return { status: "UNKNOWN", detail: { error: "pg_stat_activity_unavailable" } };
  }
}

async function probeRedis(): Promise<ProbeResult> {
  if (!redisConfigured()) return { status: "NOT_CONFIGURED", detail: { reason: "redis_url_not_set" } };
  try {
    // One command per probe (Upstash bills per command).
    const { value, ms } = await timed(() => redis().ping());
    return { status: value !== "PONG" ? "DOWN" : ms > 250 ? "DEGRADED" : "HEALTHY", latencyMs: ms, detail: { live: true } };
  } catch {
    return { status: "DOWN", detail: { error: "unreachable", live: true } };
  }
}

async function probeWorkers(): Promise<ProbeResult> {
  if (!workerConfigured()) return { status: "NOT_CONFIGURED", detail: { reason: "redis_url_not_set" } };
  const rows = await db().platformHeartbeat.findMany({ where: { kind: "worker" }, orderBy: { lastSeenAt: "desc" }, take: 50, select: { id: true, lastSeenAt: true } });
  const alive = rows.filter((r) => Date.now() - r.lastSeenAt.getTime() < WORKER_STALE_MS).length;
  const stale = rows.length - alive;
  if (!rows.length) return { status: "UNKNOWN", detail: { alive: 0, stale: 0, reason: "never_seen" } };
  return { status: alive === 0 ? "DOWN" : stale > 0 ? "DEGRADED" : "HEALTHY", detail: { alive, stale, lastSeenAt: rows[0]!.lastSeenAt.toISOString() } };
}

/** Queue backlog thresholds (waiting + delayed, dead-letter excluded). Shared with the alert rules. */
export const BACKLOG_WARN = 1_000;
export const BACKLOG_CRITICAL = 10_000;

async function probeQueues(): Promise<ProbeResult> {
  if (!workerConfigured()) return { status: "NOT_CONFIGURED", detail: { reason: "redis_url_not_set" } };
  const { value: depths, ms } = await timed(() => queueDepths());
  const reachable = depths.filter((d) => d.available);
  if (!reachable.length) return { status: "DOWN", latencyMs: ms, detail: { error: "redis_unreachable", live: true } };
  const work = reachable.filter((d) => d.name !== "dead-letter");
  const maxBacklog = Math.max(0, ...work.map((d) => d.waiting + d.delayed));
  const status: HealthStatus = maxBacklog >= BACKLOG_CRITICAL ? "CRITICAL" : maxBacklog >= BACKLOG_WARN ? "DEGRADED" : "HEALTHY";
  return {
    status,
    latencyMs: ms,
    detail: { live: true, queues: depths.map((d) => ({ name: d.name, available: d.available, waiting: d.waiting, active: d.active, delayed: d.delayed, failed: d.failed })), maxBacklog },
  };
}

const AI_PROBE: Record<AiProviderKey, (key: string) => Promise<{ status: number | null; ms: number; error?: string }>> = {
  anthropic: (key) => httpProbe("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": key, "anthropic-version": "2023-06-01" }),
  openai: (key) => httpProbe("https://api.openai.com/v1/models", { authorization: `Bearer ${key}` }),
  gemini: (key) => httpProbe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": key }),
};

async function probeAi(provider: AiProviderKey, breakers: { provider: string; open: boolean }[] | null): Promise<ProbeResult> {
  if (!providerKeyConfigured(provider)) return { status: "NOT_CONFIGURED", detail: { reason: "platform_key_missing" } };
  const info = AI_PROVIDERS.find((p) => p.key === provider)!;
  const r = await AI_PROBE[provider](process.env[info.envKey]!.trim());
  const open = breakers?.filter((b) => b.provider === provider && b.open).length ?? null;
  const lastSuccess = await db().costLedgerEntry.findFirst({ where: { provider }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null);
  let status = providerStatus(r);
  if (status === "HEALTHY" && open) status = "DEGRADED";
  return { status, latencyMs: r.ms, detail: { http: r.status, error: r.error ?? null, openBreakers: open, lastSuccessfulCallAt: lastSuccess?.createdAt.toISOString() ?? null, live: true } };
}

async function emailTraffic() {
  const rows = await db().emailMessage.groupBy({ by: ["status"], where: { createdAt: { gte: since(60 * MIN) } }, _count: { _all: true } });
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { sent1h: n("SENT"), failed1h: n("FAILED"), notSent1h: n("NOT_CONFIGURED") };
}

async function probeEmail(): Promise<ProbeResult> {
  if (!emailConfigured()) return { status: "NOT_CONFIGURED", detail: { reason: "email_provider_not_set" } };
  const traffic = await emailTraffic();
  const traf = trafficStatus(traffic.failed1h, traffic.sent1h + traffic.failed1h, 5);
  const provider = env().EMAIL_PROVIDER ?? "resend";
  const key = env().EMAIL_API_KEY;
  if (provider === "smtp" || !key) return { status: traf, detail: { provider, ...traffic, live: false, reason: provider === "smtp" ? "smtp_not_live_probed" : "no_api_key" } };
  const r = provider === "postmark" ? await httpProbe("https://api.postmarkapp.com/server", { "x-postmark-server-token": key }) : await httpProbe("https://api.resend.com/domains", { authorization: `Bearer ${key}` });
  const live = providerStatus(r);
  return { status: worstStatus([live, traf]), latencyMs: r.ms, detail: { provider, http: r.status, error: r.error ?? null, ...traffic, live: true } };
}

async function probePayments(): Promise<ProbeResult> {
  if (!billingConfigured()) return { status: "NOT_CONFIGURED", detail: { reason: "stripe_key_missing" } };
  const r = await httpProbe("https://api.stripe.com/v1/balance", { authorization: `Bearer ${env().STRIPE_SECRET_KEY}` });
  const [failedPayments24h, webhookEvents24h] = await Promise.all([
    db().stripeEvent.count({ where: { type: "invoice.payment_failed", processedAt: { gte: since(24 * 60 * MIN) } } }),
    db().stripeEvent.count({ where: { processedAt: { gte: since(24 * 60 * MIN) } } }),
  ]);
  return { status: providerStatus(r), latencyMs: r.ms, detail: { http: r.status, error: r.error ?? null, failedPayments24h, webhookEvents24h, webhookSecret: !!env().STRIPE_WEBHOOK_SECRET, live: true } };
}

async function connectionHealth(provider: string | string[]) {
  const rows = await db().integrationConnection.groupBy({ by: ["status"], where: { provider: Array.isArray(provider) ? { in: provider } : provider }, _count: { _all: true } });
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { connected: n("CONNECTED"), error: n("ERROR"), disconnected: n("DISCONNECTED") };
}

async function probeStorage(): Promise<ProbeResult> {
  // No platform-wide object store: files live in tenants' own S3 connections or in the database fallback.
  const s3 = await connectionHealth("s3");
  const total = s3.connected + s3.error;
  if (!total) return { status: "OPERATIONAL", detail: { ...s3, mode: "database_fallback" } };
  return { status: trafficStatus(s3.error, total, 1), detail: { ...s3, mode: "tenant_s3" } };
}

async function probeTelephony(): Promise<ProbeResult> {
  const tw = await connectionHealth("twilio_voice");
  if (tw.connected + tw.error === 0) return { status: "NOT_CONFIGURED", detail: { ...tw, reason: "no_twilio_connections" } };
  const calls = await db().voiceCall.groupBy({ by: ["status"], where: { createdAt: { gte: since(60 * MIN) } }, _count: { _all: true } }).catch(() => [] as { status: string; _count: { _all: number } }[]);
  const failed = calls.filter((c) => c.status === "FAILED").reduce((a, c) => a + c._count._all, 0);
  const total = calls.reduce((a, c) => a + c._count._all, 0);
  return { status: worstStatus([trafficStatus(tw.error, tw.connected + tw.error, 1), trafficStatus(failed, total, 5)]), detail: { ...tw, calls1h: total, failedCalls1h: failed } };
}

async function probeWebhooks(): Promise<ProbeResult> {
  const rows = await db().integrationWebhookDelivery.groupBy({ by: ["status"], where: { updatedAt: { gte: since(60 * MIN) } }, _count: { _all: true } });
  const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const delivered = n("SUCCEEDED");
  const failed = n("FAILED");
  const pending = n("PENDING");
  return { status: trafficStatus(failed, delivered + failed, 20), detail: { delivered1h: delivered, failed1h: failed, pending1h: pending } };
}

async function probeOauth(): Promise<ProbeResult> {
  const configured = (["google", "github", "microsoft"] as const).filter((p) => !!oauthCredentials(p));
  if (!configured.length) return { status: "NOT_CONFIGURED", detail: { providers: [] } };
  const failures = await db().auditLog.count({ where: { category: "SECURITY", createdAt: { gte: since(60 * MIN) }, action: { startsWith: "auth.oauth" }, NOT: { action: { contains: "linked" } } } }).catch(() => 0);
  return { status: "OPERATIONAL", detail: { providers: configured, oauthEvents1h: failures } };
}

async function probeIntegrations(): Promise<ProbeResult> {
  const [conns, syncs] = await Promise.all([
    db().integrationConnection.groupBy({ by: ["status"], _count: { _all: true } }),
    db().integrationSyncRun.groupBy({ by: ["status"], where: { startedAt: { gte: since(60 * MIN) } }, _count: { _all: true } }),
  ]);
  const c = (s: string) => conns.find((r) => r.status === s)?._count._all ?? 0;
  const sOf = (s: string) => syncs.find((r) => r.status === s)?._count._all ?? 0;
  const syncFailed = sOf("FAILED");
  const syncTotal = syncs.reduce((a, r) => a + r._count._all, 0);
  const connected = c("CONNECTED");
  const errored = c("ERROR");
  if (connected + errored === 0) return { status: "OPERATIONAL", detail: { connected, errored, syncs1h: syncTotal, failedSyncs1h: syncFailed, reason: "no_connections" } };
  return { status: trafficStatus(syncFailed, syncTotal, 10), detail: { connected, errored, syncs1h: syncTotal, failedSyncs1h: syncFailed } };
}

/** Latest check per service (one DISTINCT ON query). */
export async function latestChecks(): Promise<Map<string, { status: HealthStatus; latencyMs: number | null; detail: Prisma.JsonValue; checkedAt: Date }>> {
  const rows = await db().$queryRaw<{ service: string; status: HealthStatus; latency_ms: number | null; detail: Prisma.JsonValue; checked_at: Date }[]>(Prisma.sql`
    SELECT DISTINCT ON (service) service, status::text AS status, latency_ms, detail, checked_at
    FROM service_health_checks WHERE checked_at >= now() - interval '7 days' ORDER BY service, checked_at DESC`);
  return new Map(rows.map((r) => [r.service, { status: r.status, latencyMs: r.latency_ms, detail: r.detail, checkedAt: r.checked_at }]));
}

/**
 * Run every due probe and store the results (worker job `ops.monitor`). Returns the number of rows written. Each
 * probe is isolated: one failing probe records UNKNOWN for its service and never stops the others.
 */
export async function runHealthProbes(opts: { force?: boolean } = {}): Promise<number> {
  const last = await latestChecks().catch(() => new Map());
  const now = Date.now();
  const due = HEALTH_SERVICES.filter((s) => opts.force || !last.get(s.key) || now - last.get(s.key)!.checkedAt.getTime() >= s.everyMs - 30_000);
  if (!due.length) return 0;
  const controls = await getControls().catch(() => null);
  const maintenance = controls?.maintenanceMode ?? false;
  const needsBreakers = due.some((s) => s.key.startsWith("ai."));
  const breakers = needsBreakers
    ? await import("@/server/modules/agents/router").then((m) => m.breakerSnapshot()).catch(() => null)
    : null;
  const PROBES: Record<string, () => Promise<ProbeResult>> = {
    web: () => probeSelf(env().APP_URL, maintenance),
    admin: () => probeSelf(env().ADMIN_URL, false),
    api: () => probeApi(maintenance),
    auth: probeAuth,
    db: probeDb,
    "db.connections": probeDbConnections,
    redis: probeRedis,
    workers: probeWorkers,
    queues: probeQueues,
    "ai.anthropic": () => probeAi("anthropic", breakers),
    "ai.openai": () => probeAi("openai", breakers),
    "ai.gemini": () => probeAi("gemini", breakers),
    email: probeEmail,
    payments: probePayments,
    storage: probeStorage,
    telephony: probeTelephony,
    webhooks: probeWebhooks,
    oauth: probeOauth,
    integrations: probeIntegrations,
  };
  const results = await Promise.all(
    due.map(async (s) => {
      try {
        return { service: s.key, ...(await PROBES[s.key]!()) };
      } catch (err) {
        logger.warn({ service: s.key, err: err instanceof Error ? err.message : String(err) }, "health probe failed");
        return { service: s.key, status: "UNKNOWN" as HealthStatus, detail: { error: "probe_failed" } };
      }
    }),
  );
  const checkedAt = new Date();
  await db().serviceHealthCheck.createMany({
    data: results.map((r) => ({ service: r.service, status: r.status, latencyMs: r.latencyMs ?? null, detail: (r.detail ?? {}) as Prisma.InputJsonValue, checkedAt })),
  });
  return results.length;
}

// ───────────── Read side ─────────────

interface UptimeRow {
  service: string;
  up24: bigint;
  n24: bigint;
  up7: bigint;
  n7: bigint;
  up30: bigint;
  n30: bigint;
}

const pct = (up: bigint, n: bigint) => (Number(n) >= 6 ? Math.round((Number(up) / Number(n)) * 10_000) / 100 : null);

async function uptime(service?: string) {
  const up = Prisma.join(UP.map((s) => Prisma.sql`${s}`));
  const measured = Prisma.join(MEASURED.map((s) => Prisma.sql`${s}`));
  const rows = await db().$queryRaw<UptimeRow[]>(Prisma.sql`
    SELECT service,
      COUNT(*) FILTER (WHERE status::text IN (${up}) AND checked_at >= now() - interval '24 hours')::bigint AS up24,
      COUNT(*) FILTER (WHERE status::text IN (${measured}) AND checked_at >= now() - interval '24 hours')::bigint AS n24,
      COUNT(*) FILTER (WHERE status::text IN (${up}) AND checked_at >= now() - interval '7 days')::bigint AS up7,
      COUNT(*) FILTER (WHERE status::text IN (${measured}) AND checked_at >= now() - interval '7 days')::bigint AS n7,
      COUNT(*) FILTER (WHERE status::text IN (${up}))::bigint AS up30,
      COUNT(*) FILTER (WHERE status::text IN (${measured}))::bigint AS n30
    FROM service_health_checks
    WHERE checked_at >= now() - interval '30 days' ${service ? Prisma.sql`AND service = ${service}` : Prisma.empty}
    GROUP BY service`);
  return new Map(rows.map((r) => [r.service, { h24: pct(r.up24, r.n24), d7: pct(r.up7, r.n7), d30: pct(r.up30, r.n30), samples30d: Number(r.n30) }]));
}

/** Worst status per hour over the last 24 h, oldest first (null = no check in that hour). */
async function hourlyStrip(service?: string) {
  const rows = await db().$queryRaw<{ service: string; h: number; worst: number; latency: number | null }[]>(Prisma.sql`
    SELECT service, FLOOR(EXTRACT(EPOCH FROM (now() - checked_at)) / 3600)::int AS h,
      MAX(CASE status::text WHEN 'DOWN' THEN 7 WHEN 'CRITICAL' THEN 6 WHEN 'DEGRADED' THEN 5 WHEN 'MAINTENANCE' THEN 4 WHEN 'UNKNOWN' THEN 3 WHEN 'NOT_CONFIGURED' THEN 1 ELSE 0 END)::int AS worst,
      AVG(latency_ms)::float AS latency
    FROM service_health_checks
    WHERE checked_at >= now() - interval '24 hours' ${service ? Prisma.sql`AND service = ${service}` : Prisma.empty}
    GROUP BY 1, 2`);
  const byRank: Record<number, HealthStatus> = { 7: "DOWN", 6: "CRITICAL", 5: "DEGRADED", 4: "MAINTENANCE", 3: "UNKNOWN", 1: "NOT_CONFIGURED", 0: "HEALTHY" };
  const out = new Map<string, { status: (HealthStatus | null)[]; latency: (number | null)[] }>();
  for (const r of rows) {
    if (r.h < 0 || r.h > 23) continue;
    const e = out.get(r.service) ?? { status: Array(24).fill(null), latency: Array(24).fill(null) };
    e.status[23 - r.h] = byRank[r.worst] ?? "UNKNOWN";
    e.latency[23 - r.h] = r.latency === null ? null : Math.round(r.latency);
    out.set(r.service, e);
  }
  return out;
}

/** The probe job is considered stale when nothing was checked for this long (3 missed ticks). */
export const PROBE_STALE_MS = 16 * MIN;

/** Config presence per service (booleans only, never values). */
function configuration(key: string): Record<string, boolean | string | null> {
  const e = env();
  switch (key) {
    case "web":
      return { APP_URL: !!e.APP_URL };
    case "admin":
      return { ADMIN_URL: !!e.ADMIN_URL };
    case "api":
      return { APP_URL: !!e.APP_URL, TRUSTED_PROXY_HOPS: e.TRUSTED_PROXY_HOPS > 0 };
    case "auth":
      return { email: emailConfigured(), oauthGoogle: !!oauthCredentials("google"), oauthGithub: !!oauthCredentials("github"), oauthMicrosoft: !!oauthCredentials("microsoft") };
    case "db":
    case "db.connections":
      return { DATABASE_URL: true };
    case "redis":
    case "queues":
    case "workers":
      return { REDIS_URL: redisConfigured() };
    case "email":
      return { EMAIL_PROVIDER: e.EMAIL_PROVIDER ?? null, EMAIL_API_KEY: !!e.EMAIL_API_KEY, EMAIL_FROM: !!e.EMAIL_FROM, SMTP_HOST: !!e.SMTP_HOST };
    case "payments":
      return { STRIPE_SECRET_KEY: billingConfigured(), STRIPE_WEBHOOK_SECRET: !!e.STRIPE_WEBHOOK_SECRET };
    case "oauth":
      return { google: !!oauthCredentials("google"), github: !!oauthCredentials("github"), microsoft: !!oauthCredentials("microsoft") };
    default:
      if (key.startsWith("ai.")) {
        const p = key.slice(3) as AiProviderKey;
        const info = AI_PROVIDERS.find((x) => x.key === p);
        return info ? { [info.envKey]: providerKeyConfigured(p) } : {};
      }
      return {};
  }
}

/** Health center overview: current status, latency, last check, uptime and 24 h strip per service. */
export async function healthCenter(ctx: RequestContext) {
  await requireAnyPlatform(ctx, HEALTH_READ);
  const [last, up, strip, failures, openIncidents, openAlerts, controls] = await Promise.all([
    latestChecks(),
    uptime(),
    hourlyStrip(),
    db().serviceHealthCheck.findMany({ where: { checkedAt: { gte: since(24 * 60 * MIN) }, status: { in: ["DOWN", "CRITICAL", "DEGRADED"] } }, orderBy: { checkedAt: "desc" }, take: 25, select: { id: true, service: true, status: true, latencyMs: true, detail: true, checkedAt: true } }),
    db().platformIncident.findMany({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, orderBy: { detectedAt: "desc" }, take: 20, select: { id: true, number: true, title: true, severity: true, status: true, services: true, detectedAt: true } }),
    db().platformAlert.groupBy({ by: ["service"], where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, service: { not: null } }, _count: { _all: true } }),
    getControls(),
  ]);
  const newest = Math.max(0, ...[...last.values()].map((c) => c.checkedAt.getTime()));
  const probeStale = !newest || Date.now() - newest > PROBE_STALE_MS;
  const services = HEALTH_SERVICES.map((s) => {
    const c = last.get(s.key);
    const stale = !!c && Date.now() - c.checkedAt.getTime() > s.everyMs * 3 + MIN;
    return {
      key: s.key,
      group: s.group,
      deps: s.deps,
      everyMs: s.everyMs,
      status: (c ? (stale ? "UNKNOWN" : c.status) : "UNKNOWN") as HealthStatus,
      recordedStatus: c?.status ?? null,
      stale,
      latencyMs: c?.latencyMs ?? null,
      checkedAt: c?.checkedAt ?? null,
      detail: (c?.detail ?? {}) as Record<string, unknown>,
      uptime: up.get(s.key) ?? { h24: null, d7: null, d30: null, samples30d: 0 },
      strip: strip.get(s.key) ?? { status: Array(24).fill(null), latency: Array(24).fill(null) },
      openIncidents: openIncidents.filter((i) => i.services.includes(s.key)).length,
      openAlerts: openAlerts.find((a) => a.service === s.key)?._count._all ?? 0,
    };
  });
  const configuredStatuses = services.filter((s) => s.status !== "NOT_CONFIGURED").map((s) => s.status);
  return {
    overall: controls.maintenanceMode ? ("MAINTENANCE" as HealthStatus) : configuredStatuses.length ? worstStatus(configuredStatuses) : ("UNKNOWN" as HealthStatus),
    maintenance: controls.maintenanceMode,
    probeStale,
    lastProbeAt: newest ? new Date(newest) : null,
    counts: Object.fromEntries(HEALTH_STATUSES.map((st) => [st, services.filter((s) => s.status === st).length])) as Record<HealthStatus, number>,
    services,
    recentFailures: failures,
    openIncidents,
    observability: observabilityStatus(),
  };
}

export const healthHistoryInput = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), status: z.enum(HEALTH_STATUSES).optional() });

/** One service: current status, uptime windows, 24 h latency/status, check history, failures, deps, config, incidents. */
export async function serviceHealthDetail(ctx: RequestContext, key: string, raw: z.input<typeof healthHistoryInput> = {}) {
  await requireAnyPlatform(ctx, HEALTH_READ);
  const def = serviceDef(key);
  if (!def) throw notFound("Service");
  const f = healthHistoryInput.parse(raw);
  const [last, up, strip, history, failures, incidents, alerts] = await Promise.all([
    latestChecks(),
    uptime(key),
    hourlyStrip(key),
    db().serviceHealthCheck.findMany({ where: { service: key, ...(f.status ? { status: f.status } : {}) }, orderBy: { id: "desc" }, take: f.limit + 1, ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}) }),
    db().serviceHealthCheck.findMany({ where: { service: key, status: { in: ["DOWN", "CRITICAL", "DEGRADED"] } }, orderBy: { checkedAt: "desc" }, take: 20 }),
    db().platformIncident.findMany({ where: { services: { has: key } }, orderBy: { detectedAt: "desc" }, take: 20, select: { id: true, number: true, title: true, severity: true, status: true, detectedAt: true, resolvedAt: true } }),
    db().platformAlert.findMany({ where: { service: key }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, title: true, severity: true, status: true, rule: true, count: true, lastSeenAt: true } }),
  ]);
  const c = last.get(key);
  const hasMore = history.length > f.limit;
  const page = hasMore ? history.slice(0, f.limit) : history;
  const dependents = HEALTH_SERVICES.filter((s) => s.deps.includes(key)).map((s) => s.key);
  return {
    key,
    def,
    current: c ? { ...c, stale: Date.now() - c.checkedAt.getTime() > def.everyMs * 3 + MIN } : null,
    uptime: up.get(key) ?? { h24: null, d7: null, d30: null, samples30d: 0 },
    strip: strip.get(key) ?? { status: Array(24).fill(null), latency: Array(24).fill(null) },
    history: page,
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
    failures,
    dependencies: def.deps.map((d) => ({ key: d, status: (last.get(d)?.status ?? "UNKNOWN") as HealthStatus, checkedAt: last.get(d)?.checkedAt ?? null })),
    dependents: dependents.map((d) => ({ key: d, status: (last.get(d)?.status ?? "UNKNOWN") as HealthStatus })),
    configuration: configuration(key),
    incidents,
    alerts,
  };
}

/** Retention: health checks are kept 30 days. */
export async function purgeHealthChecks(): Promise<number> {
  const r = await db().serviceHealthCheck.deleteMany({ where: { checkedAt: { lt: since(30 * 24 * 60 * MIN) } } });
  return r.count;
}
