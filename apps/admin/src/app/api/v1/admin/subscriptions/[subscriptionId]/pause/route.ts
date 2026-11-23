import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminSubscriptionPause, subscriptionPauseInput } from "@/server/modules/billing/admin-actions";

/** Pause or resume collection (Stripe pause_collection). */
export const POST = route<{ subscriptionId: string }>({ auth: "required", name: "POST /admin/subscriptions/:subscriptionId/pause", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { subscriptionId }) =>
  adminSubscriptionPause(ctx, subscriptionId, await body(req, subscriptionPauseInput)),
);
