import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { delegateInitiative } from "@/server/modules/objectives/execution";

type P = { orgId: string; companyId: string; objectiveId: string; initiativeId: string };

/** POST — hand the initiative to the objective's owner AI employee as a delegated command run. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/objectives/:id/initiatives/:id/delegate", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, initiativeId }) => delegateInitiative(ctx, orgId, companyId, initiativeId),
);
