import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { leadMessageInput, sendLeadMessage } from "@/server/modules/crm/guided";

/** Email a lead (message written or edited by a person). Returns the provider's real status. */
export const POST = route<{ orgId: string; companyId: string; leadId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/leads/:leadId/message", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, leadId }) => sendLeadMessage(ctx, orgId, companyId, leadId, await body(req, leadMessageInput)),
);
