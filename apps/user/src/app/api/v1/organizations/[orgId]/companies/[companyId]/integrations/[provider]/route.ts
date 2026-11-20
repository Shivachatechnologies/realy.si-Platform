import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { disconnectIntegration, getIntegration, settingsInput, updateIntegrationSettings } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, provider }) => getIntegration(ctx, orgId, companyId, provider));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/integrations/:provider", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, provider }) => updateIntegrationSettings(ctx, orgId, companyId, provider, await body(req, settingsInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/integrations/:provider", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, provider }) => disconnectIntegration(ctx, orgId, companyId, provider),
);
