import { body, route } from "@/server/core/http";
import { signIn, signInInput } from "@/server/modules/auth/service";
import { withSessionCookie } from "../cookies";

export const POST = route({ auth: "none", rateLimit: { name: "sign-in", limit: 10, windowMs: 60_000 } }, async ({ req, ctx }) => {
  const r = await signIn(ctx, await body(req, signInInput));
  return withSessionCookie({ mfaRequired: r.mfaRequired }, r.token, r.session.expiresAt);
});
