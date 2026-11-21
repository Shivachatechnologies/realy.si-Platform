import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteGoal, getGoal, updateGoal, updateGoalInput } from "@/server/modules/objectives/goals";

type P = { orgId: string; companyId: string; goalId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, goalId }) => getGoal(ctx, orgId, companyId, goalId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/goals/:goalId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, goalId }) => updateGoal(ctx, orgId, companyId, goalId, await body(req, updateGoalInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/goals/:goalId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, goalId }) => deleteGoal(ctx, orgId, companyId, goalId),
);
