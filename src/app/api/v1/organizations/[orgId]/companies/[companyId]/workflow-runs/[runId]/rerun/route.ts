import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { rerunFromStep, rerunInput } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; runId: string };

/** Re-run a finished run from a chosen step. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflow-runs/:runId/rerun", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx, req }, { orgId, companyId, runId }) => rerunFromStep(ctx, orgId, companyId, runId, await body(req, rerunInput)),
);
