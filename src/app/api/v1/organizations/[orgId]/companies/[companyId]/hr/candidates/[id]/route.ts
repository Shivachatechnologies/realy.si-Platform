import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveCandidate, candidatePatch, getCandidateApi, updateCandidate } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getCandidateApi(ctx, orgId, companyId, id));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/candidates/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateCandidate(ctx, orgId, companyId, id, await body(req, candidatePatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/candidates/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveCandidate(ctx, orgId, companyId, id));
