import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminSubscriptionChangePlan, subscriptionPlanInput } from "@/server/modules/billing/admin-actions";

/** Upgrade / downgrade through Stripe (prorated); applied locally by the webhook. */
export const POST = route<{ subscriptionId: string }>({ auth: "required", name: "POST /admin/subscriptions/:subscriptionId/plan", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { subscriptionId }) =>
  adminSubscriptionChangePlan(ctx, subscriptionId, await body(req, subscriptionPlanInput)),
);
