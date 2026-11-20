import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { enrichAccount } from "@/server/modules/crm/intel";

type P = { orgId: string; companyId: string; accountId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/intel/accounts/:accountId/enrich", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, accountId }) => enrichAccount(ctx, orgId, companyId, accountId),
);
