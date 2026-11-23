import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { requireAnyPlatform } from "./access";
import { aiByDay, fill, fillAi, since, trendDays, type DayRow } from "./trends";

/** AI Control Center daily series (stream C; split out of trends.ts in Step 0). */

/** Daily AI tokens/cost for the AI Control Center (any window up to 90 days). */
export async function aiDailySeries(ctx: RequestContext, days: number) {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  const d = Math.min(90, Math.max(1, Math.floor(days)));
  const [ai, failed] = await Promise.all([
    aiByDay(since(d)),
    db().$queryRaw<DayRow[]>`SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM agent_tasks WHERE status = 'FAILED' AND completed_at >= ${since(d)} GROUP BY 1`,
  ]);
  return { days: trendDays(d), ...fillAi(ai, d), failed: fill(failed, d) };
}
