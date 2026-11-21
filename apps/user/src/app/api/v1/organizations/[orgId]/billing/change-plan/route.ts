import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { changePlanInput, changeSubscriptionPlan } from "@/server/modules/billing/stripe-billing";

/** Upgrade / downgrade / switch interval of an existing Stripe subscription (applied when Stripe's webhook confirms). */
export const POST = route<{ orgId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/billing/change-plan", rateLimits: LIMITS.billing, idempotent: true },
  async ({ req, ctx }, { orgId }) => changeSubscriptionPlan(ctx, orgId, await body(req, changePlanInput)),
);
