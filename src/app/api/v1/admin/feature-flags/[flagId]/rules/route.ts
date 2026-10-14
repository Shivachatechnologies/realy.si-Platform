import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { flagRuleInput, upsertFlagRule } from "@/server/modules/flags/service";

export const POST = route<{ flagId: string }>({ auth: "required", name: "POST /admin/feature-flags/:flagId/rules", rateLimits: LIMITS.admin }, async ({ req, ctx }, { flagId }) => upsertFlagRule(ctx, flagId, await body(req, flagRuleInput)));
