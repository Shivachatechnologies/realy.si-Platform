import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { grantPlatformRole, grantPlatformRoleInput } from "@/server/modules/admin/users";

export const POST = route<{ userId: string }>({ auth: "required", name: "POST /admin/users/:id/roles", rateLimits: LIMITS.admin }, async ({ req, ctx }, { userId }) =>
  grantPlatformRole(ctx, userId, await body(req, grantPlatformRoleInput)),
);
