import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveListing, getOwnListing, listingInput, updateListing } from "@/server/modules/marketplace/service";

type P = { orgId: string; listingId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, listingId }) => getOwnListing(ctx, orgId, listingId));
export const PATCH = route<P>(
  {
    auth: "required",
    name: "PATCH /organizations/:orgId/marketplace/listings/:listingId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId, listingId }) => updateListing(ctx, orgId, listingId, await body(req, listingInput)),
);
/** Archives (listings are never hard-deleted: installations reference them). */
export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/marketplace/listings/:listingId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, listingId }) => archiveListing(ctx, orgId, listingId),
);
