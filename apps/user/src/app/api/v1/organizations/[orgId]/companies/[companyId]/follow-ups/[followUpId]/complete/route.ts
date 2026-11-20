import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { completeFollowUp } from "@/server/modules/crm/service";

export const POST = route<{ orgId: string; companyId: string; followUpId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/follow-ups/:followUpId/complete", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, followUpId }) => completeFollowUp(ctx, orgId, companyId, followUpId),
);
