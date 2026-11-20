import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { accountInput, createAccount, listAccounts, parseAccountFilters } from "@/server/modules/crm/accounts";

type P = { orgId: string; companyId: string };

/** GET ?q=&type=&owner=&tag=&sort=&page= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const r = await listAccounts(ctx, orgId, companyId, parseAccountFilters(Object.fromEntries(req.nextUrl.searchParams)));
  return { data: r.rows, total: r.total, page: r.page, pageSize: r.pageSize };
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/accounts", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createAccount(ctx, orgId, companyId, await body(req, accountInput)),
);
