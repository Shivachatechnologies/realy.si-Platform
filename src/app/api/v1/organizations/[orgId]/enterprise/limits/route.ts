import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requirePermission } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getOrgLimits, limitsInput, updateLimits } from "@/server/modules/enterprise/policy";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => {
  await requirePermission(ctx, "organizations.read", orgChain(orgId));
  return getOrgLimits(orgId);
});
export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/enterprise/limits",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => updateLimits(ctx, orgId, await body(req, limitsInput)),
);
