import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createAccessReview, createReviewInput, listAccessReviews } from "@/server/modules/admin/access-reviews";

export const GET = route({ auth: "required", name: "GET /admin/access-reviews" }, async ({ ctx }) => listAccessReviews(ctx));

/** Start a review from the current platform grants. */
export const POST = route({ auth: "required", name: "POST /admin/access-reviews", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => createAccessReview(ctx, await body(req, createReviewInput)));
