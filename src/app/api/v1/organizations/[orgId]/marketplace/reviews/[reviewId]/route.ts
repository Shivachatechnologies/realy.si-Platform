import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteReview } from "@/server/modules/marketplace/service";

type P = { orgId: string; reviewId: string };

export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/marketplace/reviews/:reviewId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, reviewId }) => {
    await deleteReview(ctx, orgId, reviewId);
    return { ok: true };
  },
);
