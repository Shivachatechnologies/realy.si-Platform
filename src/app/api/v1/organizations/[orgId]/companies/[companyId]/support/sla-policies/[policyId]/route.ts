import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteSlaPolicy, saveSlaPolicy, slaPolicyInput } from "@/server/modules/support/config";

type P = { orgId: string; companyId: string; policyId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/sla-policies/:policyId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, policyId }) => saveSlaPolicy(ctx, orgId, companyId, policyId, await body(req, slaPolicyInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/sla-policies/:policyId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, policyId }) => deleteSlaPolicy(ctx, orgId, companyId, policyId),
);
