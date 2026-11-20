import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeEmailAccount, syncMailboxNow } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string; accountId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/accounts/:accountId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, accountId }) => syncMailboxNow(ctx, orgId, companyId, accountId),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/email/accounts/:accountId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, accountId }) => removeEmailAccount(ctx, orgId, companyId, accountId),
);
