import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteCompetitor, updateCompetitor, updateCompetitorInput } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string; competitorId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/seo/competitors/:competitorId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, competitorId }) => updateCompetitor(ctx, orgId, companyId, competitorId, await body(req, updateCompetitorInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/seo/competitors/:competitorId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, competitorId }) => deleteCompetitor(ctx, orgId, companyId, competitorId));
