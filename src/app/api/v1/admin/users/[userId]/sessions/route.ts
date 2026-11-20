import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokeUserSessions } from "@/server/modules/admin/users";

/** Revoke all of a user's sessions. */
export const DELETE = route<{ userId: string }>({ auth: "required", name: "DELETE /admin/users/:id/sessions", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  revokeUserSessions(ctx, userId, await body(req, z.object({ reason: z.string() }))),
);
