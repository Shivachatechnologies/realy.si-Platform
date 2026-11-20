import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { accountInput, addEmailAccount, listEmailAccounts } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listEmailAccounts(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/accounts", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => addEmailAccount(ctx, orgId, companyId, await body(req, accountInput)),
);
