import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyGoalPlan, applyPlanInput } from "@/server/modules/objectives/plan";

/** Create the reviewed plan's objectives, key results, milestones, projects and tasks. */
export const POST = route<{ orgId: string; companyId: string; goalId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/goals/:goalId/plan/apply", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, goalId }) => applyGoalPlan(ctx, orgId, companyId, goalId, await body(req, applyPlanInput)),
);
