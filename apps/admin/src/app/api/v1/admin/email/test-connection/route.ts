import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { testEmailConnection } from "@/server/modules/admin/email-admin";

/** Check the platform provider credentials (nothing is sent). */
export const POST = route({ auth: "required", name: "POST /admin/email/test-connection", rateLimits: LIMITS.admin }, async ({ ctx }) => testEmailConnection(ctx));
