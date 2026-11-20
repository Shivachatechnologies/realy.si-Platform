import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { bulkInput, bulkUpdateLeads } from "@/server/modules/crm/service";

export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/leads/bulk", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => bulkUpdateLeads(ctx, orgId, companyId, await body(req, bulkInput)),
);
