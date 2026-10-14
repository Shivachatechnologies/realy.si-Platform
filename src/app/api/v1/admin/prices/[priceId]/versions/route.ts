import { body, route } from "@/server/core/http";
import { schedulePriceChange, schedulePriceChangeInput } from "@/server/modules/pricing/service";

export const POST = route<{ priceId: string }>({ auth: "required" }, async ({ req, ctx }, { priceId }) =>
  schedulePriceChange(ctx, priceId, await body(req, schedulePriceChangeInput)),
);
