import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { objectiveStatusInput, setObjectiveStatus } from "@/server/modules/objectives/service";

export const PUT = route<{ orgId: string; companyId: string; objectiveId: string }>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/objectives/:id/status", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, objectiveId }) => setObjectiveStatus(ctx, orgId, companyId, objectiveId, await body(req, objectiveStatusInput)),
);
