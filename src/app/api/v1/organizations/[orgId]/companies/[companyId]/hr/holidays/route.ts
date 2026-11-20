import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createHoliday, holidayInput } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/holidays", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createHoliday(ctx, orgId, companyId, await body(req, holidayInput)));
