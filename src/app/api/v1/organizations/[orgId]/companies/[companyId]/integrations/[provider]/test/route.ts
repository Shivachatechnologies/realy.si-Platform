import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { testIntegration } from "@/server/modules/integrations/service";

type P = { orgId: string; companyId: string; provider: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integrations/:provider/test", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, provider }) => testIntegration(ctx, orgId, companyId, provider),
);
