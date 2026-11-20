import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { connectionPatchInput, deleteConnection, updateConnection } from "@/server/modules/enterprise/sso";

type P = { orgId: string; connectionId: string };

export const PATCH = route<P>(
  {
    auth: "required",
    name: "PATCH /organizations/:orgId/enterprise/sso/connections/:connectionId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId, connectionId }) => updateConnection(ctx, orgId, connectionId, await body(req, connectionPatchInput)),
);
export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/enterprise/sso/connections/:connectionId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, connectionId }) => {
    await deleteConnection(ctx, orgId, connectionId);
    return { ok: true };
  },
);
