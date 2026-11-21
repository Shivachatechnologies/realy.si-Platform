import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProject, createProjectInput, listProjects } from "@/server/modules/creative/pipeline";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({ data: await listProjects(ctx, orgId, companyId, { q: req.nextUrl.searchParams.get("q")?.slice(0, 200) || undefined, status: req.nextUrl.searchParams.get("status") ?? undefined }) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/projects", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createProject(ctx, orgId, companyId, await body(req, createProjectInput)));
