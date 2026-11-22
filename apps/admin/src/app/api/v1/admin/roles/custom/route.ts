import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createPlatformRole, createPlatformRoleInput, customPlatformRoles } from "@/server/modules/admin/roles";
import { requireAnyPlatform } from "@/server/modules/admin/access";

export const GET = route({ auth: "required", name: "GET /admin/roles/custom" }, async ({ ctx }) => {
  await requireAnyPlatform(ctx, ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"]);
  return customPlatformRoles();
});

/** Create a custom platform role (platform.roles.manage, MFA re-check, platform permissions you hold only). */
export const POST = route({ auth: "required", name: "POST /admin/roles/custom", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }) => createPlatformRole(ctx, await body(req, createPlatformRoleInput)));
