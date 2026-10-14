import { body, route } from "@/server/core/http";
import { updatePlan, updatePlanInput } from "@/server/modules/pricing/service";

export const PATCH = route<{ planId: string }>({ auth: "required" }, async ({ req, ctx }, { planId }) => updatePlan(ctx, planId, await body(req, updatePlanInput)));
