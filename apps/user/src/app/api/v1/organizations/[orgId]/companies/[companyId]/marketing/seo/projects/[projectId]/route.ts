import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveProject, getProject, updateProject, updateProjectInput } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string; projectId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, projectId }) => getProject(ctx, orgId, companyId, projectId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/seo/projects/:projectId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => updateProject(ctx, orgId, companyId, projectId, await body(req, updateProjectInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/seo/projects/:projectId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, projectId }) => archiveProject(ctx, orgId, companyId, projectId));
