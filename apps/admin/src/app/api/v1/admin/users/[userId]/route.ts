import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteUserInput, getPlatformUser, requestUserDeletion } from "@/server/modules/admin/users";

export const GET = route<{ userId: string }>({ auth: "required", name: "GET /admin/users/:id" }, async ({ ctx }, { userId }) => getPlatformUser(ctx, userId));

/** Delete with a grace period: PENDING_DELETION now, purged (anonymized) when `graceDays` end unless restored. */
export const DELETE = route<{ userId: string }>({ auth: "required", name: "DELETE /admin/users/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  requestUserDeletion(ctx, userId, await body(req, deleteUserInput)),
);
