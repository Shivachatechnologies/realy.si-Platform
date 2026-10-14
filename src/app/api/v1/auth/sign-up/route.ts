import { body, route } from "@/server/core/http";
import { signUp, signUpInput } from "@/server/modules/auth/service";
import { withSessionCookie } from "../cookies";

export const POST = route({ auth: "none", rateLimit: { name: "sign-up", limit: 10, windowMs: 60_000 } }, async ({ req, ctx }) => {
  const r = await signUp(ctx, await body(req, signUpInput));
  return withSessionCookie({ mfaRequired: false }, r.token, r.session.expiresAt);
});
