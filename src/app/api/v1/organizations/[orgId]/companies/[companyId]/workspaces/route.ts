import { body, route } from "@/server/core/http";
import { createWorkspace, createWorkspaceInput, listWorkspaces } from "@/server/modules/companies/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listWorkspaces(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  createWorkspace(ctx, orgId, companyId, await body(req, createWorkspaceInput)),
);
