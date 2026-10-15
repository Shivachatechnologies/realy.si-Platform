import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { billingProfileInput, getBillingProfile, upsertBillingProfile } from "@/server/modules/billing/service";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => ({ data: await getBillingProfile(ctx, orgId) }));
export const PUT = route<P>({ auth: "required", name: "PUT /organizations/:orgId/billing-profile", rateLimits: LIMITS.billing }, async ({ req, ctx }, { orgId }) => upsertBillingProfile(ctx, orgId, await body(req, billingProfileInput)));
