import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { planLifecycleInput, publishPlan } from "@/server/modules/pricing/service";

/** DRAFT / DISABLED → ACTIVE (needs a price in effect). */
export const POST = route<{ planId: string }>({ auth: "required", name: "POST /admin/plans/:planId/publish", rateLimits: LIMITS.admin }, async ({ req, ctx }, { planId }) => publishPlan(ctx, planId, await body(req, planLifecycleInput)));
