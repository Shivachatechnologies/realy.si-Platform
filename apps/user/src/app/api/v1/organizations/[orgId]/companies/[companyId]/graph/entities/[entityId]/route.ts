import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteEntity, updateEntity, updateEntityInput } from "@/server/modules/graph/service";

type P = { orgId: string; companyId: string; entityId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/graph/entities/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, entityId }) => updateEntity(ctx, orgId, companyId, entityId, await body(req, updateEntityInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/graph/entities/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, entityId }) => deleteEntity(ctx, orgId, companyId, entityId),
);
