import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { syncNow } from "@/server/modules/integrations/sync";

type P = { orgId: string; companyId: string; provider: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integrations/:provider/sync", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, provider }) => ({ data: await syncNow(ctx, orgId, companyId, provider) }),
);
