import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelRun } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string; runId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/cancel", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => cancelRun(ctx, orgId, companyId, runId),
);
