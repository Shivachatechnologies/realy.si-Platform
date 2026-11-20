import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteSubscription, getSubscriptionWithDeliveries, subscriptionUpdateInput, updateSubscription } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string; subscriptionId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, subscriptionId }) =>
  getSubscriptionWithDeliveries(ctx, orgId, companyId, subscriptionId, req.nextUrl.searchParams.get("status") ?? undefined),
);
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/integration-webhooks/:subscriptionId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, subscriptionId }) => updateSubscription(ctx, orgId, companyId, subscriptionId, await body(req, subscriptionUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/integration-webhooks/:subscriptionId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, subscriptionId }) => deleteSubscription(ctx, orgId, companyId, subscriptionId),
);
