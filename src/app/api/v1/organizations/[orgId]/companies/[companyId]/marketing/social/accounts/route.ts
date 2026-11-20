import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { accountInput, createAccount, listAccounts } from "@/server/modules/marketing/social";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => listAccounts(ctx, orgId, companyId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/social/accounts", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createAccount(ctx, orgId, companyId, await body(req, accountInput)));
