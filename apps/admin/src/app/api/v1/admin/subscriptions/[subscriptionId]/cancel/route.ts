import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminSubscriptionCancel, subscriptionCancelInput } from "@/server/modules/billing/admin-actions";

/** Cancel at period end, resume, or cancel immediately (typed confirmation). */
export const POST = route<{ subscriptionId: string }>({ auth: "required", name: "POST /admin/subscriptions/:subscriptionId/cancel", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { subscriptionId }) =>
  adminSubscriptionCancel(ctx, subscriptionId, await body(req, subscriptionCancelInput)),
);
