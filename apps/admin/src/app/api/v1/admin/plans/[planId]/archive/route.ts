import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archivePlan, planLifecycleInput } from "@/server/modules/pricing/service";

/** → DISABLED and hidden (typed plan key). Existing subscriptions keep their plan. */
export const POST = route<{ planId: string }>({ auth: "required", name: "POST /admin/plans/:planId/archive", rateLimits: LIMITS.admin }, async ({ req, ctx }, { planId }) => archivePlan(ctx, planId, await body(req, planLifecycleInput)));
