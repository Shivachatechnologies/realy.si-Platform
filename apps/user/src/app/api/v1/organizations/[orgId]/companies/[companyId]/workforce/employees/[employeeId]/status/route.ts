import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { employeeStatusInput, setEmployeeStatus } from "@/server/modules/workforce/service";

type P = { orgId: string; companyId: string; employeeId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/employees/:id/status", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, employeeId }) => setEmployeeStatus(ctx, orgId, companyId, employeeId, await body(req, employeeStatusInput)),
);
