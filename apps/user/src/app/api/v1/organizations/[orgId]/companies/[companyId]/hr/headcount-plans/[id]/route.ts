import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteHeadcountPlan, headcountPatch, updateHeadcountPlan } from "@/server/modules/hr/planning";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/headcount-plans/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) =>
  updateHeadcountPlan(ctx, orgId, companyId, id, await body(req, headcountPatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/headcount-plans/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) =>
  deleteHeadcountPlan(ctx, orgId, companyId, id),
);
