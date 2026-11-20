import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { securityInput, updateSecurity } from "@/server/modules/enterprise/policy";

type P = { orgId: string };

export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/enterprise/security",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => {
    await updateSecurity(ctx, orgId, await body(req, securityInput));
    return { ok: true };
  },
);
