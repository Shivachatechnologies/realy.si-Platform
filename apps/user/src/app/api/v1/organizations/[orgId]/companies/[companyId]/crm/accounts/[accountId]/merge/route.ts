import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { mergeAccounts, mergeAccountsInput } from "@/server/modules/crm/accounts";

type P = { orgId: string; companyId: string; accountId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/accounts/:accountId/merge", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, accountId }) => mergeAccounts(ctx, orgId, companyId, accountId, await body(req, mergeAccountsInput)),
);
