import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createCheckoutSession, quoteInput } from "@/server/modules/billing/service";

export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /organizations/:orgId/checkout/session", rateLimits: LIMITS.billing, idempotent: true }, async ({ req, ctx }, { orgId }) =>
  createCheckoutSession(ctx, orgId, await body(req, quoteInput)),
);
