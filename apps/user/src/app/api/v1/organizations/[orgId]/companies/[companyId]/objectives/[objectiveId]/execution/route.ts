import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { objectiveExecution, ownerInput, setObjectiveOwner } from "@/server/modules/objectives/execution";

type P = { orgId: string; companyId: string; objectiveId: string };

/** GET — the objective's execution: owner AI employee, live key results, initiatives and their AI work. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, objectiveId }) => objectiveExecution(ctx, orgId, companyId, objectiveId));

/** PUT — set (or clear) the objective's owner AI employee. */
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/objectives/:id/execution", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, objectiveId }) => setObjectiveOwner(ctx, orgId, companyId, objectiveId, await body(req, ownerInput)),
);
