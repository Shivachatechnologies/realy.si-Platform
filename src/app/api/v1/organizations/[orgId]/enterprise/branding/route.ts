import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { requirePermission } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { brandingInput, getBranding, updateBranding } from "@/server/modules/enterprise/branding";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => {
  await requirePermission(ctx, "organizations.read", orgChain(orgId));
  return { data: await getBranding(orgId) };
});
export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/enterprise/branding",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => updateBranding(ctx, orgId, await body(req, brandingInput)),
);
