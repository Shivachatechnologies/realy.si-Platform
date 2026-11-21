import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelCeoRun } from "@/server/modules/guide/ceo";

type P = { orgId: string; companyId: string; runId: string };

/** POST — stop work the AI CEO delegated (the run, its tasks and every task they delegated). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/guide/ceo/runs/:id/cancel", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, runId }) => cancelCeoRun(ctx, orgId, companyId, runId),
);
