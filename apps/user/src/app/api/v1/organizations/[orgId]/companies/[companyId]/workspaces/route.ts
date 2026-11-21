import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createWorkspace, createWorkspaceInput, listWorkspaces } from "@/server/modules/companies/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listWorkspaces(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workspaces", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  createWorkspace(ctx, orgId, companyId, await body(req, createWorkspaceInput)),
);
