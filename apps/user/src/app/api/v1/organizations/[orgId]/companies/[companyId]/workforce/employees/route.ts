import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createEmployee, createEmployeeInput, listEmployees } from "@/server/modules/workforce/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listEmployees(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/employees", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createEmployee(ctx, orgId, companyId, await body(req, createEmployeeInput)),
);
