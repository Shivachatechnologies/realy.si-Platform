import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveRole, updateRole, updateRoleInput } from "@/server/modules/workforce/roles";

type P = { orgId: string; companyId: string; roleId: string };

/** Edit or archive one of the company's own AI roles (B24). */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/workforce/roles/:roleId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, roleId }) => updateRole(ctx, orgId, companyId, roleId, await body(req, updateRoleInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/workforce/roles/:roleId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, roleId }) => archiveRole(ctx, orgId, companyId, roleId),
);
