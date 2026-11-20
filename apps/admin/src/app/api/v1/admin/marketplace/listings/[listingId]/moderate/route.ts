import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { moderateInput, moderateListing } from "@/server/modules/admin/marketplace";

/** Unlist / relist a marketplace listing (approve / reject: …/review). */
export const POST = route<{ listingId: string }>(
  { auth: "required", name: "POST /admin/marketplace/listings/:id/moderate", rateLimits: LIMITS.admin, idempotent: true },
  async ({ req, ctx }, { listingId }) => moderateListing(ctx, listingId, await body(req, moderateInput)),
);
