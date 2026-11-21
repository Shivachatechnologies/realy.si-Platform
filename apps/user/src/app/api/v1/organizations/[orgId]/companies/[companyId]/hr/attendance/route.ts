import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addManualAttendance, manualAttendanceInput } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/attendance", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => addManualAttendance(ctx, orgId, companyId, await body(req, manualAttendanceInput)));
