import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reviewInput, upsertReview } from "@/server/modules/marketplace/service";

type P = { orgId: string };

/** Create or update the viewer's review of a listing. */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/marketplace/reviews",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId }) => upsertReview(ctx, orgId, await body(req, reviewInput)),
);
