import { z } from "zod";
import { body, route } from "@/server/core/http";
import { setPriceStatus } from "@/server/modules/pricing/service";

const input = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(3).max(500) });

export const PATCH = route<{ priceId: string }>({ auth: "required" }, async ({ req, ctx }, { priceId }) => {
  const { status, reason } = await body(req, input);
  return setPriceStatus(ctx, priceId, status, reason);
});
