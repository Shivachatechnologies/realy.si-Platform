import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { adminManaged } from "@/server/modules/integrations/customer-access";

type P = { orgId: string; keyId: string };

/**
 * Customer API keys are not managed in the user app (docs/integrations.md "Who manages what"): every request is
 * refused with 403 and a clear message. The backend service is kept; nothing stored is deleted.
 */
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/enterprise/api-keys/:keyId", rateLimits: LIMITS.tenantWrite }, async () => {
  throw adminManaged("api_keys");
});
