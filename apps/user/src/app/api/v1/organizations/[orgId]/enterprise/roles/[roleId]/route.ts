import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteRole, updateRole, updateRoleInput } from "@/server/modules/enterprise/roles";

type P = { orgId: string; roleId: string };

export const PATCH = route<P>(
  {
    auth: "required",
    name: "PATCH /organizations/:orgId/enterprise/roles/:roleId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId, roleId }) => updateRole(ctx, orgId, roleId, await body(req, updateRoleInput)),
);
export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/enterprise/roles/:roleId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, roleId }) => {
    await deleteRole(ctx, orgId, roleId);
    return { ok: true };
  },
);
