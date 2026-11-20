import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addProjectMember, memberInput, removeProjectMember } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; projectId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/members", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => addProjectMember(ctx, orgId, companyId, projectId, await body(req, memberInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/projects/:projectId/members", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, projectId }) => removeProjectMember(ctx, orgId, companyId, projectId, req.nextUrl.searchParams.get("userId") ?? ""));
