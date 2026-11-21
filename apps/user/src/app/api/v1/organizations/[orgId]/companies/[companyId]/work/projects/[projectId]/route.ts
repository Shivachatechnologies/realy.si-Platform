import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getWorkProject, updateProjectInput, updateWorkProject } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; projectId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, projectId }) => getWorkProject(ctx, orgId, companyId, projectId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/projects/:projectId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, projectId }) => updateWorkProject(ctx, orgId, companyId, projectId, await body(req, updateProjectInput)));
