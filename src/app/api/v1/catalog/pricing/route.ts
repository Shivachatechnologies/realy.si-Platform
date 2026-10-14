import { LIMITS } from "@/server/core/limits";
import { z } from "zod";
import { route } from "@/server/core/http";
import { getPublicPricing } from "@/server/modules/pricing/service";

const query = z.object({ country: z.string().regex(/^[A-Z]{2}$/), interval: z.enum(["MONTH", "YEAR"]).default("MONTH") });

/** Public: resolved regional prices for a billing country. */
export const GET = route({ auth: "none", name: "GET /catalog/pricing", rateLimits: LIMITS.publicRead }, async ({ req }) => {
  const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { country: q.country, interval: q.interval, plans: await getPublicPricing(q.country, q.interval) };
});
