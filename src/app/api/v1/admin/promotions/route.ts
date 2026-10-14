import { body, route } from "@/server/core/http";
import { createPromotion, createPromotionInput } from "@/server/modules/pricing/service";

export const POST = route({ auth: "required" }, async ({ req, ctx }) => createPromotion(ctx, await body(req, createPromotionInput)));
