import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProject, listProjects, projectInput } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listProjects(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/seo/projects", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createProject(ctx, orgId, companyId, await body(req, projectInput)));
