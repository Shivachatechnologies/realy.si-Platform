import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setSubscriptionCancellation } from "@/server/modules/billing/stripe-billing";

const input = z.object({ cancel: z.boolean() });

/** Cancel at the end of the period (cancel: true) or keep the subscription (cancel: false). */
export const POST = route<{ orgId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/billing/cancellation", rateLimits: LIMITS.billing, idempotent: true },
  async ({ req, ctx }, { orgId }) => setSubscriptionCancellation(ctx, orgId, input.parse(await body(req, input)).cancel),
);
