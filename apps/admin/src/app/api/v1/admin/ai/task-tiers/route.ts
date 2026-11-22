import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { readTaskTiers, taskTierInput, updateTaskTier } from "@/server/modules/admin/ai-models";
import { requireAnyPlatform } from "@/server/modules/admin/access";

/** Per-task-type routing overrides (routing v2). */
export const GET = route({ auth: "required", name: "GET /admin/ai/task-tiers" }, async ({ ctx }) => {
  await requireAnyPlatform(ctx, ["platform.ai.read", "platform.ai.manage"]);
  return readTaskTiers();
});

export const PUT = route({ auth: "required", name: "PUT /admin/ai/task-tiers", rateLimits: LIMITS.admin }, async ({ req, ctx }) => updateTaskTier(ctx, await body(req, taskTierInput)));
