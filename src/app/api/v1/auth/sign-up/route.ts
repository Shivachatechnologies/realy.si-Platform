import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { logger } from "@/server/core/logger";
import { signUp, signUpInput } from "@/server/modules/auth/service";
import { sendEmailVerification } from "@/server/modules/auth/recovery";
import { withSessionCookie } from "../cookies";

export const POST = route({ auth: "none", name: "POST /auth/sign-up", rateLimits: LIMITS.signUp }, async ({ req, ctx }) => {
  const r = await signUp(ctx, await body(req, signUpInput));
  // Verification email (or a truthful NOT_CONFIGURED record); sign-up itself does not depend on delivery.
  const delivery = await sendEmailVerification(r.session.userId).then(
    (d) => d.status,
    (err) => (logger.warn({ err: (err as Error).message }, "verification email failed"), "FAILED" as const),
  );
  return withSessionCookie({ mfaRequired: false, emailVerification: delivery }, r.token, r.session.expiresAt);
});
