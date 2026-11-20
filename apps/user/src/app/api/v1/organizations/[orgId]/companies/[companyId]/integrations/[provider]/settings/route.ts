import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { apiKeyInput, updateConnectionConfig } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

/** Update a connection's provider settings (e.g. Google Ads developer token / login customer id). Never echoes secrets. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integrations/:provider/settings", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, provider }) => updateConnectionConfig(ctx, orgId, companyId, provider, await body(req, apiKeyInput)),
);
