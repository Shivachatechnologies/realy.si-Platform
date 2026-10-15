import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { quote, quoteInput } from "@/server/modules/billing/service";

export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /organizations/:orgId/checkout/quote", rateLimits: LIMITS.billing }, async ({ req, ctx }, { orgId }) => quote(ctx, orgId, await body(req, quoteInput)));
