import { LIMITS } from "@/server/core/limits";
import { z } from "zod";
import { body, route } from "@/server/core/http";
import { deleteFlagRule } from "@/server/modules/flags/service";

export const DELETE = route<{ ruleId: string }>({ auth: "required", name: "DELETE /admin/feature-flag-rules/:ruleId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { ruleId }) => {
  const { reason } = await body(req, z.object({ reason: z.string().trim().min(3).max(500) }));
  await deleteFlagRule(ctx, ruleId, reason);
  return { ok: true };
});
