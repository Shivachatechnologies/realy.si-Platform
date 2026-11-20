import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { salesRepInput, saveSalesRep } from "@/server/modules/crm/team";

type P = { orgId: string; companyId: string; ownerId: string };

/** Capacity settings of one sales team member. */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/sales/team/:ownerId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, ownerId }) => saveSalesRep(ctx, orgId, companyId, ownerId, await body(req, salesRepInput)),
);
