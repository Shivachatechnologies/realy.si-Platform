import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addonGrantInput, grantAddon } from "@/server/modules/entitlements/admin";

/** Grant add-on packs (credit allocation) to one organization for its current usage window, without payment. */
export const POST = route({ auth: "required", name: "POST /admin/entitlements/addons", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) =>
  grantAddon(ctx, await body(req, addonGrantInput)),
);
