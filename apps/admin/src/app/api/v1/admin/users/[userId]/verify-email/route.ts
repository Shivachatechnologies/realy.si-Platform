import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminVerifyEmail, verifyEmailInput } from "@/server/modules/admin/users";

/** Mark the user's email as verified (ownership confirmed by support). */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/verify-email", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  adminVerifyEmail(ctx, userId, await body(req, verifyEmailInput)),
);
