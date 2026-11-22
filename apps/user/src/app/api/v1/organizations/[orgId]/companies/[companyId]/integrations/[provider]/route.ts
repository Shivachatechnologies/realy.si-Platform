import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { adminManaged, hasCustomerOAuth } from "@/server/modules/integrations/customer-access";
import { disconnectIntegration, getIntegration } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, provider }) => getIntegration(ctx, orgId, companyId, provider));
/** Connection settings (sync schedule…) are not customer-managed (docs/integrations.md "Who manages what"). */
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/integrations/:provider", rateLimits: LIMITS.tenantWrite }, async () => {
  throw adminManaged("settings");
});
/** Customers disconnect only accounts they connected with OAuth; everything else is managed by the platform. */
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/integrations/:provider", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, provider }) => {
    if (!hasCustomerOAuth(provider)) throw adminManaged("connection", { provider });
    return disconnectIntegration(ctx, orgId, companyId, provider);
  },
);
