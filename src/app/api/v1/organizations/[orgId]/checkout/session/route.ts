import { body, route } from "@/server/core/http";
import { createCheckoutSession, quoteInput } from "@/server/modules/billing/service";

export const POST = route<{ orgId: string }>({ auth: "required" }, async ({ req, ctx }, { orgId }) =>
  createCheckoutSession(ctx, orgId, await body(req, quoteInput)),
);
