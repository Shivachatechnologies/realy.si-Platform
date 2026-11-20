import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveDepartment, departmentPatch, updateDepartment } from "@/server/modules/hr/org";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/departments/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateDepartment(ctx, orgId, companyId, id, await body(req, departmentPatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/departments/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveDepartment(ctx, orgId, companyId, id));
