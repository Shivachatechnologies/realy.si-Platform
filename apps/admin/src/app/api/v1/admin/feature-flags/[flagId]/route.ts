import { LIMITS } from "@/server/core/limits";
import { z } from "zod";
import { body, route } from "@/server/core/http";
import { setFlagDefault } from "@/server/modules/flags/service";

const input = z.object({ defaultEnabled: z.boolean(), reason: z.string().trim().min(3).max(500) });

export const PATCH = route<{ flagId: string }>({ auth: "required", name: "PATCH /admin/feature-flags/:flagId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { flagId }) => {
  const { defaultEnabled, reason } = await body(req, input);
  return setFlagDefault(ctx, flagId, defaultEnabled, reason);
});
