import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminCancelInput, adminSetCancellation } from "@/server/modules/entitlements/admin";

/** Cancel at period end, or resume, an organization's subscription. */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/entitlements/organizations/:orgId/cancellation", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { orgId }) =>
  adminSetCancellation(ctx, orgId, await body(req, adminCancelInput)),
);
