import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retryCommandStep } from "@/server/modules/guide/command";

type P = { orgId: string; companyId: string; sessionId: string; runId: string; stepId: string };

/** POST — retry a failed or blocked step of a command run (the run re-opens; skipped steps after it wait again). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/command/:sessionId/runs/:runId/steps/:stepId/retry", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, sessionId, runId, stepId }) => retryCommandStep(ctx, orgId, companyId, sessionId, runId, stepId),
);
