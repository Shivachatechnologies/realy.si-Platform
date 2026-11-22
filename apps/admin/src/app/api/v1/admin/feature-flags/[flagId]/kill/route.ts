import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { killInput, setFlagKilled } from "@/server/modules/flags/service";

/** Kill switch on / off. */
export const PUT = route<{ flagId: string }>({ auth: "required", name: "PUT /admin/feature-flags/:flagId/kill", rateLimits: LIMITS.admin }, async ({ req, ctx }, { flagId }) => setFlagKilled(ctx, flagId, await body(req, killInput)));
