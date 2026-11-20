import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { grantOverride, overrideInput } from "@/server/modules/entitlements/admin";

/** Grant (or restrict) one feature / limit for one organization, over its plan. Reason required; audited. */
export const POST = route({ auth: "required", name: "POST /admin/entitlements/overrides", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) =>
  grantOverride(ctx, await body(req, overrideInput)),
);
