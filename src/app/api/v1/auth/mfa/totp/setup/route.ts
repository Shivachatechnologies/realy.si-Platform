import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { beginTotpSetup } from "@/server/modules/auth/service";

export const POST = route({ auth: "required", name: "POST /auth/mfa/totp/setup", rateLimits: LIMITS.tenantWrite }, async ({ ctx, session }) => beginTotpSetup(ctx, session!.userId));
