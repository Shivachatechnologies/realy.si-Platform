import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listCalls, parseCallFilters, requestCall, requestCallInput } from "@/server/modules/voice/calls";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseCallFilters(sp);
  return listCalls(ctx, orgId, companyId, { ...f, leadId: sp.lead || undefined, contactId: sp.contact || undefined });
});
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/calls", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => requestCall(ctx, orgId, companyId, await body(req, requestCallInput)),
);
