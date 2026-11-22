import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { promotionStatusInput, setPromotionStatus } from "@/server/modules/pricing/service";

/** Disable or re-enable a promotion and its coupon codes. */
export const PATCH = route<{ promotionId: string }>({ auth: "required", name: "PATCH /admin/promotions/:promotionId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { promotionId }) => setPromotionStatus(ctx, promotionId, await body(req, promotionStatusInput)));
