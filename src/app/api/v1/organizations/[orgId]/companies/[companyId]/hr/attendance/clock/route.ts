import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { clock, clockInput } from "@/server/modules/hr/time";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/attendance/clock", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => clock(ctx, orgId, companyId, await body(req, clockInput)));
