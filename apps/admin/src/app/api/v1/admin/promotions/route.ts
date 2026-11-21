import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPromotion, createPromotionInput } from "@/server/modules/pricing/service";

export const POST = route({ auth: "required", name: "POST /admin/promotions", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => createPromotion(ctx, await body(req, createPromotionInput)));
