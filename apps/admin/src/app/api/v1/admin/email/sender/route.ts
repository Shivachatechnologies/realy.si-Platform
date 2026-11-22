import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { checkSenderVerification } from "@/server/modules/admin/email-admin";

/** Sender domain verification status from the provider (Resend). */
export const POST = route({ auth: "required", name: "POST /admin/email/sender", rateLimits: LIMITS.admin }, async ({ ctx }) => checkSenderVerification(ctx));
