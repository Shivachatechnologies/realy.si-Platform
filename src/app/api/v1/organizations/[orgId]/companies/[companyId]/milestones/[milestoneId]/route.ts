import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteMilestone } from "@/server/modules/objectives/service";

export const DELETE = route<{ orgId: string; companyId: string; milestoneId: string }>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/milestones/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, milestoneId }) => deleteMilestone(ctx, orgId, companyId, milestoneId),
);
