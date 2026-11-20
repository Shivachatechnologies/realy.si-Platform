import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { planInput, planObjective } from "@/server/modules/objectives/execution";

type P = { orgId: string; companyId: string; objectiveId: string };

/** POST — ask the owner AI employee to plan initiatives from the objective's live key results. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/objectives/:id/plan-initiatives", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, objectiveId }) => planObjective(ctx, orgId, companyId, objectiveId, await body(req, planInput)),
);
