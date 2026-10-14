import { body, route } from "@/server/core/http";
import { createPrice, createPriceInput } from "@/server/modules/pricing/service";

export const POST = route<{ planId: string }>({ auth: "required" }, async ({ req, ctx }, { planId }) => createPrice(ctx, planId, await body(req, createPriceInput)));
