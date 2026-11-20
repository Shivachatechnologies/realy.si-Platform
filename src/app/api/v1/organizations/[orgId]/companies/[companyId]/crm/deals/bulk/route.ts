import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { bulkDeals, dealBulkInput } from "@/server/modules/crm/deals";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/deals/bulk", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => bulkDeals(ctx, orgId, companyId, await body(req, dealBulkInput)),
);
