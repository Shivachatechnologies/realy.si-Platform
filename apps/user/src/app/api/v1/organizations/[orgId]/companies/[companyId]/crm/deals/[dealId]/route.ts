import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveDeal, dealPatch, getDeal, updateDeal } from "@/server/modules/crm/deals";

type P = { orgId: string; companyId: string; dealId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, dealId }) => getDeal(ctx, orgId, companyId, dealId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/deals/:dealId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, dealId }) => updateDeal(ctx, orgId, companyId, dealId, await body(req, dealPatch)),
);
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/deals/:dealId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, dealId }) => archiveDeal(ctx, orgId, companyId, dealId));
