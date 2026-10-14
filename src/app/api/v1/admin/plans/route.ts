import { body, route } from "@/server/core/http";
import { createPlan, createPlanInput, listCatalog, manageableMarkets } from "@/server/modules/pricing/service";

export const GET = route({ auth: "required" }, async ({ ctx }) => ({ data: await listCatalog(ctx), manageable: await manageableMarkets(ctx) }));
export const POST = route({ auth: "required" }, async ({ req, ctx }) => createPlan(ctx, await body(req, createPlanInput)));
