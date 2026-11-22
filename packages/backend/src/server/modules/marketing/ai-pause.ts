import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { isCompanyAiPaused } from "@/server/modules/workforce/autonomy-policy";

/**
 * Company kill switch ("Pause all AI", /autonomy) for the marketing module's own background loops: autopilots, Run my
 * marketing, the optimization loop and AI-scheduled social posts. Work that goes through agents/service.ts#createTask
 * or the tool gateway is already blocked there; these loops also act without a task (provider calls, auto-applied
 * optimizations, autopilot posts that nobody approved), so they check the switch themselves.
 */
export { isCompanyAiPaused };

/** Upper bound of paused companies read per worker tick (a paused company is a rare, manual state). */
const MAX_PAUSED = 5000;

/** Ids of every company whose AI is paused right now (one query per worker tick instead of one per record). */
export async function pausedCompanyIds(): Promise<Set<string>> {
  try {
    const rows = await db().autonomySettings.findMany({ where: { paused: true }, select: { companyId: true }, take: MAX_PAUSED });
    return new Set(rows.map((r) => r.companyId));
  } catch (err) {
    // Same fallback as isCompanyAiPaused: table missing (not migrated yet) → nothing is paused.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "autonomy settings unavailable");
    return new Set();
  }
}

/**
 * Social posts the marketing autopilot scheduled on its own (Auto-publish, no person approved the item) in companies
 * whose AI is paused. The publishing queue holds them until the company resumes AI; posts a person scheduled or approved
 * keep publishing.
 */
export async function heldAutopilotPostIds(paused: Set<string>): Promise<string[]> {
  if (!paused.size) return [];
  const rows = await db().marketingAutopilotItem.findMany({
    where: { companyId: { in: [...paused] }, stage: "SCHEDULED", postId: { not: null }, approvedAt: null },
    select: { postId: true },
    take: 1000,
  });
  return [...new Set(rows.map((r) => r.postId!))];
}
