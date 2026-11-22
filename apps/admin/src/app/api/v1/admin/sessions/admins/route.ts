import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { revokeAdminSessionsInput, revokeAllAdminSessions } from "@/server/modules/admin/security";

/** Revoke every platform admin session except your own (typed confirmation). */
export const DELETE = route({ auth: "required", name: "DELETE /admin/sessions/admins", rateLimits: LIMITS.admin }, async ({ req, ctx }) => revokeAllAdminSessions(ctx, await body(req, revokeAdminSessionsInput)));
