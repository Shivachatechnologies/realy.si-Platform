import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { nudgeRun } from "@/server/modules/builder/service";

type P = { orgId: string; companyId: string; runId: string };

/** Advance the run as far as it can go now (polled by the live workspace; the worker job does the same). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/advance", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, runId }) => nudgeRun(ctx, orgId, companyId, runId),
);
