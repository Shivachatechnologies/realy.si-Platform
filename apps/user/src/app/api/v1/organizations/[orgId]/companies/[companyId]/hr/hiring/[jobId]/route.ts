import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { hiringStepInput, setHiringStep } from "@/server/modules/hr/hiring";

type P = { orgId: string; companyId: string; jobId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/hiring/:jobId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, jobId }) =>
  setHiringStep(ctx, orgId, companyId, jobId, await body(req, hiringStepInput)),
);
