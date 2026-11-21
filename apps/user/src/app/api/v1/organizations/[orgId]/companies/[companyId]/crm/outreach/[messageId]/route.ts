import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { cancelOutreach, outreachPatch, updateOutreach } from "@/server/modules/crm/outreach";

type P = { orgId: string; companyId: string; messageId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/outreach/:messageId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, messageId }) => updateOutreach(ctx, orgId, companyId, messageId, await body(req, outreachPatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/outreach/:messageId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, messageId }) => cancelOutreach(ctx, orgId, companyId, messageId));
