import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { startHiringFromPlan } from "@/server/modules/hr/planning";

type P = { orgId: string; companyId: string; id: string };

/** Open the job + guided hiring journey for a planned role. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/headcount-plans/:id/hire", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, id }) =>
  startHiringFromPlan(ctx, orgId, companyId, id),
);
