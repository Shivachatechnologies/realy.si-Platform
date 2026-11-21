import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updateInitiative, updateInitiativeInput } from "@/server/modules/objectives/execution";

type P = { orgId: string; companyId: string; objectiveId: string; initiativeId: string };

/** PATCH — rename an initiative or change its status. */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/objectives/:id/initiatives/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, initiativeId }) => updateInitiative(ctx, orgId, companyId, initiativeId, await body(req, updateInitiativeInput)),
);
