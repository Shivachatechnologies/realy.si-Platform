import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiModelsInput, aiModelsOverview, updateAiModels } from "@/server/modules/admin/ai-models";

/** AI providers & models: GET overview; PUT { action: provider | profileModel | orgModel | budget, …, reason }. */
export const GET = route({ auth: "required", name: "GET /admin/ai/models" }, async ({ req, ctx }) => aiModelsOverview(ctx, { days: req.nextUrl.searchParams.get("days") }));

export const PUT = route({ auth: "required", name: "PUT /admin/ai/models", rateLimits: LIMITS.admin }, async ({ req, ctx }) => updateAiModels(ctx, await body(req, aiModelsInput)));
