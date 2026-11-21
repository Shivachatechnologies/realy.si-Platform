import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listRuns, planRun, planRunInput } from "@/server/modules/voice/runs";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listRuns(ctx, orgId, companyId) }));
/** Plan a calling run (eligibility, priority, briefs). Nothing is called until the run is started and approved. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/runs", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => planRun(ctx, orgId, companyId, await body(req, planRunInput)),
);
