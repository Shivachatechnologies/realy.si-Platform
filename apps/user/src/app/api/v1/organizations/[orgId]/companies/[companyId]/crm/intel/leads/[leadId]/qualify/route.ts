import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { qualifyLead } from "@/server/modules/crm/intel";

type P = { orgId: string; companyId: string; leadId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/intel/leads/:leadId/qualify", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, leadId }) => qualifyLead(ctx, orgId, companyId, leadId),
);
