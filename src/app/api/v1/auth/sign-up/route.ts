import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { signUp, signUpInput } from "@/server/modules/auth/service";
import { withSessionCookie } from "../cookies";

export const POST = route({ auth: "none", name: "POST /auth/sign-up", rateLimits: LIMITS.signUp }, async ({ req, ctx }) => {
  const r = await signUp(ctx, await body(req, signUpInput));
  return withSessionCookie({ mfaRequired: false }, r.token, r.session.expiresAt);
});
