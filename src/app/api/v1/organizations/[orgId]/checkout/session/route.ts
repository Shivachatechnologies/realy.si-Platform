import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { checkoutInput, createCheckoutSession } from "@/server/modules/billing/stripe-billing";

/** Returns a Stripe-hosted checkout URL, or 501 not_configured ("Billing is not configured."). */
export const POST = route<{ orgId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/checkout/session", rateLimits: LIMITS.billing, idempotent: true },
  async ({ req, ctx }, { orgId }) => createCheckoutSession(ctx, orgId, await body(req, checkoutInput)),
);
