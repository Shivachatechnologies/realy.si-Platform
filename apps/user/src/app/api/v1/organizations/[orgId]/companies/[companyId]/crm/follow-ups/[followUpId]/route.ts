import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { crmFollowUpPatch, deleteCrmFollowUp, updateCrmFollowUp } from "@/server/modules/crm/activities";

type P = { orgId: string; companyId: string; followUpId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/follow-ups/:followUpId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, followUpId }) => updateCrmFollowUp(ctx, orgId, companyId, followUpId, await body(req, crmFollowUpPatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/follow-ups/:followUpId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, followUpId }) =>
  deleteCrmFollowUp(ctx, orgId, companyId, followUpId),
);
