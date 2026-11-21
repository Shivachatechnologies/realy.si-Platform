import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { dismissDeadLetter } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; runId: string };

/** Remove a permanently failed run from the dead-letter list. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflow-runs/:runId/dismiss", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => dismissDeadLetter(ctx, orgId, companyId, runId),
);
