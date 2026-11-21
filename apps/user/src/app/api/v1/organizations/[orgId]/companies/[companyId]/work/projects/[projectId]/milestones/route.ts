import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createProjectMilestone, milestoneInput } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; projectId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/milestones", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => createProjectMilestone(ctx, orgId, companyId, projectId, await body(req, milestoneInput)));
