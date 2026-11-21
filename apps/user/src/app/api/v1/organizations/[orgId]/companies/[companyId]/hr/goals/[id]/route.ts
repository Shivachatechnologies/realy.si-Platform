import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteGoal, goalPatch, updateGoal } from "@/server/modules/hr/performance";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/goals/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateGoal(ctx, orgId, companyId, id, await body(req, goalPatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/goals/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => deleteGoal(ctx, orgId, companyId, id));
