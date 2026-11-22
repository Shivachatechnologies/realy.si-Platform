import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { passwordResetInput, sendUserPasswordReset } from "@/server/modules/admin/people";

/** Send the standard password-reset email. */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/password-reset", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  sendUserPasswordReset(ctx, userId, await body(req, passwordResetInput)),
);
