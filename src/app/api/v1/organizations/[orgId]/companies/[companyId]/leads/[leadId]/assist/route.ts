import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assistInput, assistLead } from "@/server/modules/crm/assistant";

export const POST = route<{ orgId: string; companyId: string; leadId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/leads/:leadId/assist", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, leadId }) => assistLead(ctx, orgId, companyId, leadId, await body(req, assistInput)),
);
