import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { closeDeal, closeDealInput } from "@/server/modules/crm/deals";

type P = { orgId: string; companyId: string; dealId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/deals/:dealId/close", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, dealId }) => closeDeal(ctx, orgId, companyId, dealId, await body(req, closeDealInput)),
);
