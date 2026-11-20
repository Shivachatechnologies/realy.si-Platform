import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { interviewPatch, updateInterview } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/interviews/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateInterview(ctx, orgId, companyId, id, await body(req, interviewPatch)));
