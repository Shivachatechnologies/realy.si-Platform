import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { convertLead, convertLeadInput } from "@/server/modules/crm/conversion";

type P = { orgId: string; companyId: string; leadId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/leads/:leadId/convert", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, leadId }) => convertLead(ctx, orgId, companyId, leadId, await body(req, convertLeadInput)),
);
