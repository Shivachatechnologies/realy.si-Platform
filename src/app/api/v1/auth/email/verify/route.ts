import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { verifyEmail } from "@/server/modules/auth/recovery";

/**
 * Requires the session of the account the link was issued for. Possession of the inbox alone must not
 * confirm an account someone else registered with that address (pre-account hijacking): the owner of
 * the address can take such an account over through password reset instead, which clears it.
 */
export const POST = route({ auth: "required", name: "POST /auth/email/verify", rateLimits: LIMITS.emailVerify }, async ({ req, ctx }) => {
  const { token } = await body(req, z.object({ token: z.string().min(20).max(128) }));
  await verifyEmail(ctx, token);
  return { ok: true };
});
