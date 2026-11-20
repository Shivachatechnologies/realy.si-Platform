import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { entitlementOverview } from "@/server/modules/entitlements/offers";

/** Plan, usage of every limit, plan offers and add-ons for this organization (any member; upgrade prompts). */
export const GET = route<{ orgId: string }>({ auth: "required", name: "GET /organizations/:orgId/entitlements", rateLimits: LIMITS.billing }, async ({ ctx }, { orgId }) =>
  entitlementOverview(ctx, orgId),
);
