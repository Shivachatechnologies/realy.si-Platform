import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { decideListing, reviewDecisionInput } from "@/server/modules/marketplace/service";

type P = { listingId: string };

export const POST = route<P>(
  {
    auth: "required",
    name: "POST /admin/marketplace/listings/:listingId/review",
    rateLimits: LIMITS.admin,
    idempotent: true,
  },
  async ({ req, ctx }, { listingId }) => decideListing(ctx, listingId, await body(req, reviewDecisionInput)),
);
