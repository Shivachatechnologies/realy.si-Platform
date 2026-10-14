import { db } from "@/server/core/db";
import { redis } from "@/server/core/rate-limit";

/** Readiness: dependencies reachable (load balancers route traffic only when ready). */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    await db().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }
  try {
    checks.redis = (await redis().ping()) === "PONG" ? "ok" : "fail";
  } catch {
    checks.redis = "fail";
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: ok ? "ready" : "degraded", checks }, { status: ok ? 200 : 503 });
}
