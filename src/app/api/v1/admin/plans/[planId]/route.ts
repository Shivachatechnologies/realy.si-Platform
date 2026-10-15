import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { updatePlan, updatePlanInput } from "@/server/modules/pricing/service";

export const PATCH = route<{ planId: string }>({ auth: "required", name: "PATCH /admin/plans/:planId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { planId }) => updatePlan(ctx, planId, await body(req, updatePlanInput)));
