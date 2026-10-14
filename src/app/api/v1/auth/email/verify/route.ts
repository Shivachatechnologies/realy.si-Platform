import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { verifyEmail } from "@/server/modules/auth/recovery";

export const POST = route({ auth: "none", name: "POST /auth/email/verify", rateLimits: LIMITS.emailVerify }, async ({ req, ctx }) => {
  const { token } = await body(req, z.object({ token: z.string().min(20).max(128) }));
  await verifyEmail(ctx, token);
  return { ok: true };
});
