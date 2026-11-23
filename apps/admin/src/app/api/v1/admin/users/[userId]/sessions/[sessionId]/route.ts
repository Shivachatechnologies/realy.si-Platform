import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { z } from "zod";
import { revokeUserSession } from "@/server/modules/admin/users";

/** Revoke one of the user's sessions. */
export const DELETE = route<{ userId: string; sessionId: string }>({ auth: "required", name: "DELETE /admin/users/:id/sessions/:sessionId", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId, sessionId }) =>
  revokeUserSession(ctx, userId, sessionId, await body(req, z.object({ reason: z.string() }))),
);
