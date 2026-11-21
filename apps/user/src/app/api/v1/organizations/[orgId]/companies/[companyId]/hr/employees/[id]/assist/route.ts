import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assistEmployee, employeeAssistInput } from "@/server/modules/hr/manager";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/employees/:id/assist", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => assistEmployee(ctx, orgId, companyId, id, await body(req, employeeAssistInput)));
