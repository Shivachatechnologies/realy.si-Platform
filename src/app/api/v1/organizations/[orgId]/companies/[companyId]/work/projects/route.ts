import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProjectInput, createWorkProject, listWorkProjects, parseProjectFilters } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listWorkProjects(ctx, orgId, companyId, parseProjectFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createWorkProject(ctx, orgId, companyId, await body(req, createProjectInput)));
