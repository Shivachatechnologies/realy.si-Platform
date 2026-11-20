import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { accountPatch, archiveAccount, getAccount, updateAccount } from "@/server/modules/crm/accounts";

type P = { orgId: string; companyId: string; accountId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, accountId }) => getAccount(ctx, orgId, companyId, accountId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/accounts/:accountId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, accountId }) => updateAccount(ctx, orgId, companyId, accountId, await body(req, accountPatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/accounts/:accountId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, accountId }) =>
  archiveAccount(ctx, orgId, companyId, accountId),
);
