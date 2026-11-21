import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteUserInput, getPlatformUser, softDeleteUser } from "@/server/modules/admin/users";

export const GET = route<{ userId: string }>({ auth: "required", name: "GET /admin/users/:id" }, async ({ ctx }, { userId }) => getPlatformUser(ctx, userId));

/** Safe delete (soft, anonymized, audited). */
export const DELETE = route<{ userId: string }>({ auth: "required", name: "DELETE /admin/users/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  softDeleteUser(ctx, userId, await body(req, deleteUserInput)),
);
