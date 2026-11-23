import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideAccessReviewItem, decideInput } from "@/server/modules/admin/access-reviews";

/** KEEP or REVOKE one grant (REVOKE takes effect immediately). */
export const POST = route<{ reviewId: string; itemId: string }>({ auth: "required", name: "POST /admin/access-reviews/:id/items/:itemId", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { reviewId, itemId }) =>
  decideAccessReviewItem(ctx, reviewId, itemId, await body(req, decideInput)),
);
