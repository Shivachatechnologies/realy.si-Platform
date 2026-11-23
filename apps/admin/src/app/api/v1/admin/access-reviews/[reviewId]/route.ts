import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { closeAccessReview, closeReviewInput, getAccessReview } from "@/server/modules/admin/access-reviews";

export const GET = route<{ reviewId: string }>({ auth: "required", name: "GET /admin/access-reviews/:id" }, async ({ ctx }, { reviewId }) => getAccessReview(ctx, reviewId));

/** Complete (every item decided) or cancel the review. */
export const POST = route<{ reviewId: string }>({ auth: "required", name: "POST /admin/access-reviews/:id", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { reviewId }) =>
  closeAccessReview(ctx, reviewId, await body(req, closeReviewInput)),
);
