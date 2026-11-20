import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { approveBlueprint } from "@/server/modules/builder/blueprint";
import { blueprintInput } from "@/server/modules/builder/steps";

type P = { orgId: string; companyId: string; runId: string };

/** POST <Company Blueprint> — the founder's edited blueprint: creates the records through each module's service and continues the run. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/blueprint", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 256 * 1024 },
  async ({ req, ctx }, { orgId, companyId, runId }) => approveBlueprint(ctx, orgId, companyId, runId, await body(req, blueprintInput)),
);
