import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { resetPassword, resetPasswordInput } from "@/server/modules/auth/recovery";

export const POST = route({ auth: "none", name: "POST /auth/password/reset", rateLimits: LIMITS.passwordResetConfirm }, async ({ req, ctx }) => {
  await resetPassword(ctx, await body(req, resetPasswordInput));
  return { ok: true };
});
