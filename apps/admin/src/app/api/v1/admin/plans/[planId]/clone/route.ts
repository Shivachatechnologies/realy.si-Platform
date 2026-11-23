import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { clonePlan, clonePlanInput } from "@/server/modules/pricing/service";

/** Copy a plan (entitlements, optionally prices) into a new hidden DRAFT. */
export const POST = route<{ planId: string }>({ auth: "required", name: "POST /admin/plans/:planId/clone", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { planId }) => clonePlan(ctx, planId, await body(req, clonePlanInput)));
