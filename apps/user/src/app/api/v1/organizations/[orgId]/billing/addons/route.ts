import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addonCheckoutInput, createAddonCheckout } from "@/server/modules/billing/stripe-billing";

/** Stripe one-time checkout for add-on packs; 501 not_configured without Stripe. */
export const POST = route<{ orgId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/billing/addons", rateLimits: LIMITS.billing, idempotent: true },
  async ({ req, ctx }, { orgId }) => createAddonCheckout(ctx, orgId, await body(req, addonCheckoutInput)),
);
