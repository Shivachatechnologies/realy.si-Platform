import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { logTime, timeEntryInput } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/time", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => logTime(ctx, orgId, companyId, await body(req, timeEntryInput)));
