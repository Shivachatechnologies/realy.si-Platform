import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSubscription, listSubscriptions, subscriptionInput } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listSubscriptions(ctx, orgId, companyId) }));
/** Returns the signing secret once. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integration-webhooks", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createSubscription(ctx, orgId, companyId, await body(req, subscriptionInput)),
);
