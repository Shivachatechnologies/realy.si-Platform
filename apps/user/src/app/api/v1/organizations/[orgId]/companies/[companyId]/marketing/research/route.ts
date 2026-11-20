import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createResearchReport, listResearchReports, RESEARCH_KINDS, researchInput } from "@/server/modules/marketing/research-reports";
import { enumParam, pageParam } from "@/server/modules/marketing/common";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const q = Object.fromEntries(req.nextUrl.searchParams);
  return listResearchReports(ctx, orgId, companyId, { kind: enumParam(q, "kind", RESEARCH_KINDS), page: pageParam(q) });
});
// Research runs inline (provider queries in parallel), so the request may take a while.
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/research", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createResearchReport(ctx, orgId, companyId, await body(req, researchInput)));
