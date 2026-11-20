import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { apiKeyInput, saveApiKeyConnection } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

/** Connect an API-key provider. The response never contains the secret. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integrations/:provider/credentials", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, provider }) => saveApiKeyConnection(ctx, orgId, companyId, provider, await body(req, apiKeyInput)),
);
