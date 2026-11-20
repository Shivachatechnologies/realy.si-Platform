import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminChangePlan, adminPlanChangeInput } from "@/server/modules/entitlements/admin";

/** Upgrade / downgrade an organization's Stripe subscription (applied when Stripe's webhook confirms). */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/entitlements/organizations/:orgId/subscription", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { orgId }) =>
  adminChangePlan(ctx, orgId, await body(req, adminPlanChangeInput)),
);
