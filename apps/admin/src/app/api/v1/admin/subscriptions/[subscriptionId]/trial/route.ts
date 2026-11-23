import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminSubscriptionExtendTrial, subscriptionTrialInput } from "@/server/modules/billing/admin-actions";

/** Extend a trial (never shortens it). */
export const POST = route<{ subscriptionId: string }>({ auth: "required", name: "POST /admin/subscriptions/:subscriptionId/trial", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { subscriptionId }) =>
  adminSubscriptionExtendTrial(ctx, subscriptionId, await body(req, subscriptionTrialInput)),
);
