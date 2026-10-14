import { body, route } from "@/server/core/http";
import { flagRuleInput, upsertFlagRule } from "@/server/modules/flags/service";

export const POST = route<{ flagId: string }>({ auth: "required" }, async ({ req, ctx }, { flagId }) => upsertFlagRule(ctx, flagId, await body(req, flagRuleInput)));
