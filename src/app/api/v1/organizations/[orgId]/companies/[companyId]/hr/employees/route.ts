import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createEmployee, employeeInput, listEmployees, parseEmployeeFilters } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listEmployees(ctx, orgId, companyId, parseEmployeeFilters(Object.fromEntries(req.nextUrl.searchParams))) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/employees", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createEmployee(ctx, orgId, companyId, await body(req, employeeInput)));
