import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { interviewInput, scheduleInterview } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string; id: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/candidates/:id/interviews", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, id }) => scheduleInterview(ctx, orgId, companyId, id, await body(req, interviewInput)));
