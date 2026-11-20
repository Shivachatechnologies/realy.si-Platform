import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addListingVersion, versionInput } from "@/server/modules/marketplace/service";

type P = { orgId: string; listingId: string };

export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/marketplace/listings/:listingId/versions",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
    maxBodyBytes: 256 * 1024,
  },
  async ({ req, ctx }, { orgId, listingId }) => addListingVersion(ctx, orgId, listingId, await body(req, versionInput)),
);
