import { body, route } from "@/server/core/http";
import { createCustomRole, customRoleInput, listRoles } from "@/server/modules/rbac/service";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => {
  const roles = await listRoles(ctx, orgId);
  return {
    data: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      assignableAt: r.assignableAt,
      permissions: r.permissions.map((p) => p.permission.key).sort(),
    })),
  };
});
export const POST = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId }) => createCustomRole(ctx, orgId, await body(req, customRoleInput)));
