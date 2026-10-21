import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getLead, updateLead, updateLeadInput } from "@/server/modules/crm/service";

type P = { orgId: string; companyId: string; leadId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, leadId }) => getLead(ctx, orgId, companyId, leadId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/leads/:leadId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, leadId }) => updateLead(ctx, orgId, companyId, leadId, await body(req, updateLeadInput)),
);
