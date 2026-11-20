import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createWorkspace, listCompanyWorkspaces, workspaceInput } from "@/server/modules/enterprise/company";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({
  data: await listCompanyWorkspaces(ctx, orgId, companyId),
}));
/** Create a workspace (enforces the organization's workspaces-per-company limit). */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/enterprise/workspaces",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId, companyId }) => createWorkspace(ctx, orgId, companyId, await body(req, workspaceInput)),
);
