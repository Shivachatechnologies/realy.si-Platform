import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { bulkContacts, contactBulkInput } from "@/server/modules/crm/contacts";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/contacts/bulk", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => bulkContacts(ctx, orgId, companyId, await body(req, contactBulkInput)),
);
