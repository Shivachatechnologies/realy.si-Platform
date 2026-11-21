import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { submitOutreach } from "@/server/modules/crm/outreach";

type P = { orgId: string; companyId: string; messageId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/outreach/:messageId/submit", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, messageId }) => submitOutreach(ctx, orgId, companyId, messageId),
);
