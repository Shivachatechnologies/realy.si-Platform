import { LIMITS } from "@/server/core/limits";
import { isAppError } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { createGoal, createGoalInput, GOAL_HORIZONS, GOAL_STATUSES, listGoals } from "@/server/modules/objectives/goals";
import { startGoalPlan } from "@/server/modules/objectives/plan";

type P = { orgId: string; companyId: string };
const pick = <T extends string>(values: readonly T[], v: string | null) => (v && (values as readonly string[]).includes(v) ? (v as T) : undefined);

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => {
  const sp = req.nextUrl.searchParams;
  return { data: await listGoals(ctx, orgId, companyId, { q: sp.get("q")?.slice(0, 200) || undefined, status: pick(GOAL_STATUSES, sp.get("status")), horizon: pick(GOAL_HORIZONS, sp.get("horizon")) }) };
});

/** Create a goal; with `plan: true` also start the AI decomposition (a failure to start is returned, the goal stays). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/goals", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => {
    const { plan, ...input } = createGoalInput.parse(await body(req, createGoalInput));
    const goal = await createGoal(ctx, orgId, companyId, input);
    if (!plan) return { goal, task: null, planError: null };
    try {
      return { goal, task: await startGoalPlan(ctx, orgId, companyId, goal.id), planError: null };
    } catch (err) {
      if (!isAppError(err)) throw err;
      return { goal, task: null, planError: { code: err.code, message: err.message, reason: (err.details?.reason as string | undefined) ?? null } };
    }
  },
);
