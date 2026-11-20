import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteRisk, updateRisk, updateRiskInput } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; riskId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/risks/:riskId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, riskId }) => updateRisk(ctx, orgId, companyId, riskId, await body(req, updateRiskInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/risks/:riskId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, riskId }) => deleteRisk(ctx, orgId, companyId, riskId));
