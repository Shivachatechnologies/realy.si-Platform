import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokeSession, revokeSessionInput } from "@/server/modules/admin/ops";

/** Revoke one session of any user (platform.security.manage). */
export const DELETE = route<{ sessionId: string }>({ auth: "required", name: "DELETE /admin/sessions/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { sessionId }) =>
  revokeSession(ctx, sessionId, await body(req, revokeSessionInput)),
);
