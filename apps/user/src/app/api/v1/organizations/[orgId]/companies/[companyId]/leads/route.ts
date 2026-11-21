import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createLead, createLeadInput, listLeads, parseLeadFilters } from "@/server/modules/crm/service";

type P = { orgId: string; companyId: string };

/** GET ?q=&owner=me|unassigned|<userId>&stage=&temperature= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  data: await listLeads(ctx, orgId, companyId, parseLeadFilters(Object.fromEntries(req.nextUrl.searchParams))),
}));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/leads", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createLead(ctx, orgId, companyId, await body(req, createLeadInput)),
);
