import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveProject, getProject, updateProject, updateProjectInput } from "@/server/modules/creative/pipeline";

type P = { orgId: string; companyId: string; projectId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, projectId }) => getProject(ctx, orgId, companyId, projectId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/creative/projects/:projectId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, projectId }) => updateProject(ctx, orgId, companyId, projectId, await body(req, updateProjectInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/creative/projects/:projectId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, projectId }) => archiveProject(ctx, orgId, companyId, projectId));
