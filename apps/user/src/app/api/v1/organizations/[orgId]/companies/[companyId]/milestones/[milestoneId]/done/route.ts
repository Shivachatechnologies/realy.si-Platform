import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { milestoneDoneInput, setMilestoneDone } from "@/server/modules/objectives/service";

export const PUT = route<{ orgId: string; companyId: string; milestoneId: string }>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/milestones/:id/done", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, milestoneId }) => setMilestoneDone(ctx, orgId, companyId, milestoneId, await body(req, milestoneDoneInput)),
);
