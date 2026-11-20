import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteProjectMilestone, updateMilestoneInput, updateProjectMilestone } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; milestoneId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/milestones/:milestoneId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, milestoneId }) => updateProjectMilestone(ctx, orgId, companyId, milestoneId, await body(req, updateMilestoneInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/milestones/:milestoneId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, milestoneId }) => deleteProjectMilestone(ctx, orgId, companyId, milestoneId));
