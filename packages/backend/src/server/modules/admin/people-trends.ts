import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { isUuid, requirePlatform } from "./access";
import { aiByDay, fill, fillAi, since, trendDays, type DayRow } from "./trends";

/** Per-organization and per-user 30-day series (stream B; split out of trends.ts in Step 0). */

/** 30-day activity of one organization (AI tasks, tokens, cost, failures, API requests). Caller already opened the audited tenant view. */
export async function organizationTrends(ctx: RequestContext, organizationId: string) {
  await requirePlatform(ctx, "platform.organizations.read");
  if (!isUuid(organizationId)) return null;
  const from = since();
  const [ai, failed, api] = await Promise.all([
    aiByDay(from, Prisma.sql`AND organization_id = ${organizationId}::uuid`),
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM agent_tasks WHERE organization_id = ${organizationId}::uuid AND status = 'FAILED' AND completed_at >= ${from} GROUP BY 1`,
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, SUM(quantity)::bigint AS n FROM usage_records WHERE organization_id = ${organizationId}::uuid AND meter = 'api.request' AND occurred_at >= ${from} GROUP BY 1`,
  ]);
  return { days: trendDays(), ai: fillAi(ai), failed: fill(failed), apiRequests: fill(api) };
}

/** 30-day activity of one user: sign-ins and AI tasks they started (tokens and cost). */
export async function userTrends(ctx: RequestContext, userId: string) {
  await requirePlatform(ctx, "platform.users.read");
  if (!isUuid(userId)) return null;
  const from = since();
  const [signIns, ai] = await Promise.all([
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM sessions WHERE user_id = ${userId}::uuid AND created_at >= ${from} GROUP BY 1`,
    aiByDay(from, Prisma.sql`AND created_by_id = ${userId}::uuid`),
  ]);
  return { days: trendDays(), signIns: fill(signIns), ai: fillAi(ai) };
}
