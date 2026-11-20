import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createMilestone, createMilestoneInput } from "@/server/modules/objectives/service";

export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/milestones", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createMilestone(ctx, orgId, companyId, await body(req, createMilestoneInput)),
);
