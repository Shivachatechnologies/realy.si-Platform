import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { planPatch, updatePlan } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/development-plans/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updatePlan(ctx, orgId, companyId, id, await body(req, planPatch)));
