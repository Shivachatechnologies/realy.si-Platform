import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokeOverride } from "@/server/modules/entitlements/admin";

const input = z.object({ reason: z.string() });

/** Revoke an override (kept for history). */
export const DELETE = route<{ overrideId: string }>({ auth: "required", name: "DELETE /admin/entitlements/overrides/:overrideId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { overrideId }) =>
  revokeOverride(ctx, overrideId, (await body(req, input)).reason),
);
