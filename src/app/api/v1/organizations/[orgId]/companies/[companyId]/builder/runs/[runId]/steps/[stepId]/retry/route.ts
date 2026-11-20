import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { retryInput, retryStep } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string; runId: string; stepId: string };

/** POST { feedback? } — re-run a failed step. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/steps/:stepId/retry", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, runId, stepId }) => retryStep(ctx, orgId, companyId, runId, stepId, await body(req, retryInput)),
);
