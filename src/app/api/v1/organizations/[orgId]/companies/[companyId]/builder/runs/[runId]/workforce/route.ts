import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { approveWorkforce } from "@/server/modules/builder/blueprint";
import { workforceInput } from "@/server/modules/builder/steps";

type P = { orgId: string; companyId: string; runId: string };

/** POST { team: [...] } — hire the approved AI workforce (with reporting lines) and continue the run. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/workforce", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 128 * 1024 },
  async ({ req, ctx }, { orgId, companyId, runId }) => approveWorkforce(ctx, orgId, companyId, runId, await body(req, workforceInput)),
);
