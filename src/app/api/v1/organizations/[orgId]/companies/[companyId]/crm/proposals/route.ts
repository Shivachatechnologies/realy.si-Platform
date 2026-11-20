import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProposal, listProposals, parseProposalFilters, proposalInput } from "@/server/modules/crm/proposals";

type P = { orgId: string; companyId: string };

/** GET ?q=&status=&deal=&owner=&sort=&page= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const r = await listProposals(ctx, orgId, companyId, parseProposalFilters(Object.fromEntries(req.nextUrl.searchParams)));
  return { data: r.rows, total: r.total, page: r.page, pageSize: r.pageSize };
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/proposals", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 256 * 1024 },
  async ({ req, ctx }, { orgId, companyId }) => createProposal(ctx, orgId, companyId, await body(req, proposalInput)),
);
