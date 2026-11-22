import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { grantRoleToUser, grantToUserInput } from "@/server/modules/admin/roles";

/** Grant a platform role (optionally temporary: expiresAt), with reason and MFA re-check (mfaCode). */
export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/roles", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  grantRoleToUser(ctx, userId, await body(req, grantToUserInput)),
);
