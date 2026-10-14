import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { schedulePriceChange, schedulePriceChangeInput } from "@/server/modules/pricing/service";

export const POST = route<{ priceId: string }>({ auth: "required", name: "POST /admin/prices/:priceId/versions", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { priceId }) =>
  schedulePriceChange(ctx, priceId, await body(req, schedulePriceChangeInput)),
);
