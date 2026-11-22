import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { sendTestEmail, testSendInput } from "@/server/modules/admin/email-admin";

/** Send a test message through the platform provider. */
export const POST = route({ auth: "required", name: "POST /admin/email/test-send", rateLimits: LIMITS.admin }, async ({ req, ctx }) => sendTestEmail(ctx, await body(req, testSendInput)));
