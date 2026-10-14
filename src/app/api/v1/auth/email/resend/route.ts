import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { sendEmailVerification } from "@/server/modules/auth/recovery";

export const POST = route({ auth: "required", name: "POST /auth/email/resend", rateLimits: LIMITS.emailResend }, async ({ session }) => {
  const r = await sendEmailVerification(session!.userId);
  return { delivery: r.status };
});
