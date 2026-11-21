import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { forgotPasswordInput, requestPasswordReset } from "@/server/modules/auth/recovery";

/** Always the same response for existing and unknown accounts (no enumeration). */
export const POST = route({ auth: "none", name: "POST /auth/password/forgot", rateLimits: LIMITS.passwordResetRequest }, async ({ req, ctx }) =>
  requestPasswordReset(ctx, await body(req, forgotPasswordInput)),
);
