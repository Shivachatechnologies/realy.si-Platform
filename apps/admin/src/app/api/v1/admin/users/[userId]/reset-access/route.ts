import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { resetAccessInput, resetUserAccess } from "@/server/modules/admin/people";

/** Reset access: revoke sessions, require MFA re-enrolment and send a password reset email. */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/reset-access", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  resetUserAccess(ctx, userId, await body(req, resetAccessInput)),
);
