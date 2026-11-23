import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { restoreUser, restoreUserInput } from "@/server/modules/admin/users";

/** Cancel a scheduled deletion (PENDING_DELETION → ACTIVE). */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/restore", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  restoreUser(ctx, userId, await body(req, restoreUserInput)),
);
