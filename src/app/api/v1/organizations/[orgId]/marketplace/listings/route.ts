import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createListing, listingInput, listOwnListings, parseListingFilters, searchListings } from "@/server/modules/marketplace/service";

type P = { orgId: string };

/** GET ?scope=own (the organization's listings, every status) or the public catalog: ?q=&type=&category=&pricing=free|paid&sort=&page= */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  if (params.scope === "own") return { data: await listOwnListings(ctx, orgId) };
  return searchListings(ctx, orgId, parseListingFilters(params));
});
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/marketplace/listings",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId }) => createListing(ctx, orgId, await body(req, listingInput)),
);
