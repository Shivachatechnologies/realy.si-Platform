import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteCompetitor, updateCompetitor, updateCompetitorInput } from "@/server/modules/work/product-research";

type P = { orgId: string; companyId: string; competitorId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/competitors/:competitorId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, competitorId }) => updateCompetitor(ctx, orgId, companyId, competitorId, await body(req, updateCompetitorInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/product/competitors/:competitorId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, competitorId }) => deleteCompetitor(ctx, orgId, companyId, competitorId));

