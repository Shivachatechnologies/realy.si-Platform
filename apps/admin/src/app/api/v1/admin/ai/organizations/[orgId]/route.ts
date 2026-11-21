import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { orgAiPauseInput, setOrgAiPaused } from "@/server/modules/admin/ai-models";

/** Pause / resume all AI work of one organization (organization AI restriction). */
export const PUT = route<{ orgId: string }>({ auth: "required", name: "PUT /admin/ai/organizations/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) =>
  setOrgAiPaused(ctx, orgId, await body(req, orgAiPauseInput)),
);
