import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { signIn, signInInput } from "@/server/modules/auth/service";
import { withSessionCookie } from "../cookies";

export const POST = route({ auth: "none", name: "POST /auth/sign-in", rateLimits: LIMITS.signIn }, async ({ req, ctx }) => {
  const r = await signIn(ctx, await body(req, signInInput));
  return withSessionCookie({ mfaRequired: r.mfaRequired }, r.token, r.session.expiresAt);
});
