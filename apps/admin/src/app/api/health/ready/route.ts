import { db } from "@/server/core/db";
import { redisConfigured, redisReachable } from "@/server/core/rate-limit";
import { workerHealth } from "@/server/core/job-admin";

type Check = "ok" | "fail" | "missing" | "not_configured" | "stale";

/**
 * Readiness: dependencies reachable (load balancers route traffic only when ready).
 * `schema` is "missing" when the database has not been migrated (run `prisma migrate deploy`).
 * Redis is optional for the web app (rate limits fall back to Postgres); it is required by the worker.
 * `worker` reports the background worker service from its heartbeat: "ok" (a live worker), "stale" (heartbeats stopped),
 * "missing" (never started) or "not_configured" (no REDIS_URL in production: AI tasks, schedules, syncs and webhook
 * deliveries do not run). The worker never makes the web app unready; a missing worker only degrades the status.
 * Hostnames, counts and versions are not exposed here (public endpoint): Admin → System shows the details.
 */
export async function GET() {
  const checks: Record<string, Check> = {};
  try {
    await db().$queryRaw`SELECT 1`;
    checks.database = "ok";
    const [row] = await db().$queryRaw<{ users: string | null; roles: string | null; limits: string | null }[]>`
      SELECT to_regclass('public.users')::text AS users, to_regclass('public.roles')::text AS roles, to_regclass('public.rate_limit_counters')::text AS limits`;
    checks.schema = row?.users && row.limits ? "ok" : "missing";
    if (checks.schema === "ok") checks.seed = (await db().role.count({ where: { organizationId: null } })) > 0 ? "ok" : "missing";
  } catch {
    checks.database = checks.database ?? "fail";
  }
  if (!redisConfigured()) checks.redis = "not_configured";
  else {
    // Cached for 15 s per instance (a public endpoint must not cost a Redis command per request).
    checks.redis = (await redisReachable()) ? "ok" : "fail";
  }
  let workerLastSeenAt: string | null = null;
  if (checks.database === "ok") {
    const w = await workerHealth();
    checks.worker = w.state;
    workerLastSeenAt = w.lastSeenAt?.toISOString() ?? null;
  } else {
    checks.worker = redisConfigured() ? "fail" : "not_configured";
  }
  const ok = checks.database === "ok" && checks.schema === "ok" && checks.seed === "ok";
  const degraded = checks.redis === "fail" || (checks.worker !== "ok" && checks.worker !== "not_configured");
  return Response.json(
    {
      status: ok ? (degraded ? "degraded" : "ready") : "not_ready",
      checks,
      worker: { configured: checks.worker !== "not_configured", lastSeenAt: workerLastSeenAt, message: checks.worker === "not_configured" ? "worker not configured" : null },
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
