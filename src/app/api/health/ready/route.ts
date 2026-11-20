import { db } from "@/server/core/db";
import { redis, redisConfigured } from "@/server/core/rate-limit";

type Check = "ok" | "fail" | "missing" | "not_configured";

/**
 * Readiness: dependencies reachable (load balancers route traffic only when ready).
 * `schema` is "missing" when the database has not been migrated (run `prisma migrate deploy`).
 * Redis is optional for the web app (rate limits fall back to Postgres); it is required by the worker.
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
    try {
      checks.redis = (await redis().ping()) === "PONG" ? "ok" : "fail";
    } catch {
      checks.redis = "fail";
    }
  }
  const ok = checks.database === "ok" && checks.schema === "ok" && checks.seed === "ok";
  return Response.json({ status: ok ? (checks.redis === "fail" ? "degraded" : "ready") : "not_ready", checks }, { status: ok ? 200 : 503 });
}
