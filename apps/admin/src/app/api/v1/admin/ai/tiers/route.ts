import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiRoutingOverview, tierModelsInput, updateTierModels } from "@/server/modules/admin/ai-models";

/** Tier routing table + provider health (GET); edit one class's tiers or the platform-wide row "*" (PUT, audited). */
export const GET = route({ auth: "required", name: "GET /admin/ai/tiers" }, async ({ ctx }) => aiRoutingOverview(ctx));

export const PUT = route({ auth: "required", name: "PUT /admin/ai/tiers", rateLimits: LIMITS.admin }, async ({ req, ctx }) => updateTierModels(ctx, await body(req, tierModelsInput)));
