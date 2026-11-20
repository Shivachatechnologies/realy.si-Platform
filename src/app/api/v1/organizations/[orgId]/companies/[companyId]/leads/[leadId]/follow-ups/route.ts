import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addFollowUp, followUpInput } from "@/server/modules/crm/service";

export const POST = route<{ orgId: string; companyId: string; leadId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/leads/:leadId/follow-ups", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, leadId }) => addFollowUp(ctx, orgId, companyId, leadId, await body(req, followUpInput)),
);
