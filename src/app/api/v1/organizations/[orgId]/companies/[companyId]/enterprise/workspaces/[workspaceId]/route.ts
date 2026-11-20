import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteWorkspace, renameWorkspace, workspaceInput } from "@/server/modules/enterprise/company";

type P = { orgId: string; companyId: string; workspaceId: string };

export const PATCH = route<P>(
  {
    auth: "required",
    name: "PATCH /organizations/:orgId/companies/:companyId/enterprise/workspaces/:workspaceId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, p) => renameWorkspace(ctx, p.orgId, p.companyId, p.workspaceId, await body(req, workspaceInput)),
);
export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/companies/:companyId/enterprise/workspaces/:workspaceId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, p) => {
    await deleteWorkspace(ctx, p.orgId, p.companyId, p.workspaceId);
    return { ok: true };
  },
);
