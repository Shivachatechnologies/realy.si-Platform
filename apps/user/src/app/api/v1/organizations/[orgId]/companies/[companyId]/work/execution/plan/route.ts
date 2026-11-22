import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { planExecutionInput, requestObjectiveExecutionPlan } from "@/server/modules/work/execution";

type P = { orgId: string; companyId: string };

/** POST: the AI project manager proposes the execution of an objective (approved by a person before it is created). */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/execution/plan", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  requestObjectiveExecutionPlan(ctx, orgId, companyId, await body(req, planExecutionInput)),
);
