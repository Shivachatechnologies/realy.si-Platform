import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { rotateSubscriptionSecret } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string; subscriptionId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integration-webhooks/:subscriptionId/rotate", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, subscriptionId }) => rotateSubscriptionSecret(ctx, orgId, companyId, subscriptionId),
);
