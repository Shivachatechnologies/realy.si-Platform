import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminSubscriptionApplyCoupon, subscriptionCouponInput } from "@/server/modules/billing/admin-actions";

/** Apply an active promotion's coupon to future invoices. */
export const POST = route<{ subscriptionId: string }>({ auth: "required", name: "POST /admin/subscriptions/:subscriptionId/coupon", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { subscriptionId }) =>
  adminSubscriptionApplyCoupon(ctx, subscriptionId, await body(req, subscriptionCouponInput)),
);
