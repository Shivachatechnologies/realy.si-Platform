import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getPlan, updatePlan, updatePlanInput } from "@/server/modules/marketing/plans";

type P = { orgId: string; companyId: string; planId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, planId }) => getPlan(ctx, orgId, companyId, planId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/plans/:planId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, planId }) => updatePlan(ctx, orgId, companyId, planId, await body(req, updatePlanInput)));
