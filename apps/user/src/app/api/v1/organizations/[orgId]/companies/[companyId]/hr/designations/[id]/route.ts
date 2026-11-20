import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveDesignation, designationPatch, updateDesignation } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/designations/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateDesignation(ctx, orgId, companyId, id, await body(req, designationPatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/designations/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveDesignation(ctx, orgId, companyId, id));
