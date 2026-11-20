import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveEmployee, getEmployee, updateEmployee, updateEmployeeInput } from "@/server/modules/workforce/service";

type P = { orgId: string; companyId: string; employeeId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, employeeId }) => getEmployee(ctx, orgId, companyId, employeeId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/workforce/employees/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, employeeId }) => updateEmployee(ctx, orgId, companyId, employeeId, await body(req, updateEmployeeInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/workforce/employees/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, employeeId }) => archiveEmployee(ctx, orgId, companyId, employeeId),
);
