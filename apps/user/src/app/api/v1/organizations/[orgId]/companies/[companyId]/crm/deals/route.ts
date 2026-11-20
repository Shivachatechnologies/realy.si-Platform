import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createDeal, dealInput, listDeals, parseDealFilters } from "@/server/modules/crm/deals";

type P = { orgId: string; companyId: string };

/** GET ?q=&pipeline=&stage=&owner=&status=&account=&source=&tag=&closeFrom=&closeTo=&stale=1&sort=&page= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const r = await listDeals(ctx, orgId, companyId, parseDealFilters(Object.fromEntries(req.nextUrl.searchParams)));
  return { data: r.rows, total: r.total, totals: r.totals, page: r.page, pageSize: r.pageSize };
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/deals", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createDeal(ctx, orgId, companyId, await body(req, dealInput)),
);
