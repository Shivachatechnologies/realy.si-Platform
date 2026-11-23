import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiRouting, aiRoutingInput, updateAiRouting } from "@/server/modules/admin/ai-ops";

export const GET = route({ auth: "required", name: "GET /admin/ai/routing" }, async ({ ctx }) => aiRouting(ctx));

/** { action: "fallback", chain } or { action: "credits", model, input, output } with a reason. */
export const PUT = route({ auth: "required", name: "PUT /admin/ai/routing", rateLimits: LIMITS.admin }, async ({ req, ctx }) => updateAiRouting(ctx, await body(req, aiRoutingInput)));
