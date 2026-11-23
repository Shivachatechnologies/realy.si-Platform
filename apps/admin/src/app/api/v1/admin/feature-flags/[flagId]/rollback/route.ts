import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { rollbackFlag, rollbackInput } from "@/server/modules/flags/service";

/** Restore an earlier version. */
export const POST = route<{ flagId: string }>({ auth: "required", name: "POST /admin/feature-flags/:flagId/rollback", rateLimits: LIMITS.admin }, async ({ req, ctx }, { flagId }) => rollbackFlag(ctx, flagId, await body(req, rollbackInput)));
