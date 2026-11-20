import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { accountBulkInput, bulkAccounts } from "@/server/modules/crm/accounts";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/accounts/bulk", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => bulkAccounts(ctx, orgId, companyId, await body(req, accountBulkInput)),
);
