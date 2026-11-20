import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { planningAssistInput, requestPlanningHelp } from "@/server/modules/hr/planning";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/headcount-plans/assist", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  requestPlanningHelp(ctx, orgId, companyId, await body(req, planningAssistInput)),
);
