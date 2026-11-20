import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createInitiative, initiativeInput } from "@/server/modules/objectives/execution";

type P = { orgId: string; companyId: string; objectiveId: string };

/** POST — add an initiative to an objective. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/objectives/:id/initiatives", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, objectiveId }) => createInitiative(ctx, orgId, companyId, objectiveId, await body(req, initiativeInput)),
);
