import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retryRun } from "@/server/modules/automation/service";

type P = { orgId: string; companyId: string; runId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflow-runs/:runId/retry", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => retryRun(ctx, orgId, companyId, runId),
);
