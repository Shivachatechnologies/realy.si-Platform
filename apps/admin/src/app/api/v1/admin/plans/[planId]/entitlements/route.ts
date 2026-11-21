import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { entitlementInput, setEntitlement } from "@/server/modules/pricing/service";

export const PUT = route<{ planId: string }>({ auth: "required", name: "PUT /admin/plans/:planId/entitlements", rateLimits: LIMITS.admin }, async ({ req, ctx }, { planId }) => setEntitlement(ctx, planId, await body(req, entitlementInput)));
