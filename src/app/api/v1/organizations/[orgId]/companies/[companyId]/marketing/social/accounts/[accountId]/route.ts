import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveAccount, updateAccount, updateAccountInput } from "@/server/modules/marketing/social";

type P = { orgId: string; companyId: string; accountId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/social/accounts/:accountId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, accountId }) => updateAccount(ctx, orgId, companyId, accountId, await body(req, updateAccountInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/social/accounts/:accountId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, accountId }) => archiveAccount(ctx, orgId, companyId, accountId));
