import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProject, createProjectInput } from "@/server/modules/companies/service";

export const POST = route<{ orgId: string; workspaceId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/workspaces/:workspaceId/projects", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, workspaceId }) => createProject(ctx, orgId, workspaceId, await body(req, createProjectInput)),
);
