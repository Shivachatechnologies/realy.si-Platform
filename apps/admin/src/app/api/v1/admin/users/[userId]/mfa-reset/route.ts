import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { resetUserMfa, singleResetInput } from "@/server/modules/admin/people";

/** Secure MFA reset: factors and recovery codes removed, sessions revoked (typed confirmation). */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/mfa-reset", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { userId }) =>
  resetUserMfa(ctx, userId, await body(req, singleResetInput)),
);
