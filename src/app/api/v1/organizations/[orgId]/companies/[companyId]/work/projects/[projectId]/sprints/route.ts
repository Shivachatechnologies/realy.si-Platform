import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createSprint, projectAgile, sprintInput } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; projectId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, projectId }) => projectAgile(ctx, orgId, companyId, projectId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/sprints", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => createSprint(ctx, orgId, companyId, projectId, await body(req, sprintInput)));
