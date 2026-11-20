import { route } from "@/server/core/http";
import { listReviewQueue } from "@/server/modules/marketplace/service";

/** Listings awaiting platform review. */
export const GET = route({ auth: "required" }, async ({ ctx }) => ({
  data: await listReviewQueue(ctx),
}));
