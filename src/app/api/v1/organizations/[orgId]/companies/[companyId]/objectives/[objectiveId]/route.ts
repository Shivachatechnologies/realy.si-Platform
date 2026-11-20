import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteObjective, updateObjective, updateObjectiveInput } from "@/server/modules/objectives/service";

type P = { orgId: string; companyId: string; objectiveId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/objectives/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, objectiveId }) => updateObjective(ctx, orgId, companyId, objectiveId, await body(req, updateObjectiveInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/objectives/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, objectiveId }) => deleteObjective(ctx, orgId, companyId, objectiveId),
);
