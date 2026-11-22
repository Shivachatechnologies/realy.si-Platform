import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { simulateRoute, simulateRouteInput } from "@/server/modules/admin/ai-models";

/** Effective-route simulator: org, profile, title → model (no model is called). */
export const POST = route({ auth: "required", name: "POST /admin/ai/route-simulator", rateLimits: LIMITS.admin }, async ({ req, ctx }) => simulateRoute(ctx, await body(req, simulateRouteInput)));
