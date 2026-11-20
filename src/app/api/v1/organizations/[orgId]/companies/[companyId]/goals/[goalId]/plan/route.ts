import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { startGoalPlan, startPlanInput } from "@/server/modules/objectives/plan";

/** Start (or regenerate) the AI decomposition of a goal. */
export const POST = route<{ orgId: string; companyId: string; goalId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/goals/:goalId/plan", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, goalId }) => startGoalPlan(ctx, orgId, companyId, goalId, await body(req, startPlanInput)),
);
