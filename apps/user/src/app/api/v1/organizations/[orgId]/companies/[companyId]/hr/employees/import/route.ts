import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { importEmployeesCsv, importInput } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/employees/import", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 2_200_000 }, async ({ req, ctx }, { orgId, companyId }) => importEmployeesCsv(ctx, orgId, companyId, await body(req, importInput)));
