import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { submitListing } from "@/server/modules/marketplace/service";

type P = { orgId: string; listingId: string };

export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/marketplace/listings/:listingId/submit",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ ctx }, { orgId, listingId }) => submitListing(ctx, orgId, listingId),
);
