import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deletePlatformRole, deletePlatformRoleInput, getPlatformRole, updatePlatformRole, updatePlatformRoleInput } from "@/server/modules/admin/roles";

export const GET = route<{ roleId: string }>({ auth: "required", name: "GET /admin/roles/custom/:id" }, async ({ ctx }, { roleId }) => getPlatformRole(ctx, roleId));

/** Edit a custom platform role (name, description, permissions). Built-in roles are immutable. */
export const PATCH = route<{ roleId: string }>({ auth: "required", name: "PATCH /admin/roles/custom/:id", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { roleId }) =>
  updatePlatformRole(ctx, roleId, await body(req, updatePlatformRoleInput)),
);

/** Delete a custom platform role nobody holds (typed confirmation: its key). */
export const DELETE = route<{ roleId: string }>({ auth: "required", name: "DELETE /admin/roles/custom/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { roleId }) =>
  deletePlatformRole(ctx, roleId, await body(req, deletePlatformRoleInput)),
);
