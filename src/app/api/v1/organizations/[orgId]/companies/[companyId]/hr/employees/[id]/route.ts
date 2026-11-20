import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveEmployee, employeePatch, getEmployee, updateEmployee } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getEmployee(ctx, orgId, companyId, id));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/employees/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateEmployee(ctx, orgId, companyId, id, await body(req, employeePatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/employees/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveEmployee(ctx, orgId, companyId, id));
