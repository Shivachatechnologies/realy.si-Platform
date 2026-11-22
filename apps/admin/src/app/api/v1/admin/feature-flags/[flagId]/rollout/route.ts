import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { rolloutInput, setFlagRollout } from "@/server/modules/flags/service";

/** Percentage rollout, environments and schedule. */
export const PUT = route<{ flagId: string }>({ auth: "required", name: "PUT /admin/feature-flags/:flagId/rollout", rateLimits: LIMITS.admin }, async ({ req, ctx }, { flagId }) => setFlagRollout(ctx, flagId, await body(req, rolloutInput)));
