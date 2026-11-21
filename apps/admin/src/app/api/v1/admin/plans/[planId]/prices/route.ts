import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPrice, createPriceInput } from "@/server/modules/pricing/service";

export const POST = route<{ planId: string }>({ auth: "required", name: "POST /admin/plans/:planId/prices", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { planId }) => createPrice(ctx, planId, await body(req, createPriceInput)));
