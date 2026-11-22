import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { adminManaged } from "@/server/modules/integrations/customer-access";

type P = { orgId: string; companyId: string };

/**
 * Customer webhooks are not managed in the user app (docs/integrations.md "Who manages what"): every request is
 * refused with 403 and a clear message. The backend service is kept; nothing stored is deleted.
 */
export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/integration-hooks", rateLimits: LIMITS.tenantWrite }, async () => {
  throw adminManaged("webhooks");
});
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integration-hooks", rateLimits: LIMITS.tenantWrite }, async () => {
  throw adminManaged("webhooks");
});
