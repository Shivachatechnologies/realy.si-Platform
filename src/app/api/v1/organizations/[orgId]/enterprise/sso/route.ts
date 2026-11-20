import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { enforceInput, setSsoEnforcement, ssoOverview } from "@/server/modules/enterprise/sso";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId }) => ssoOverview(ctx, orgId));
/** { enforceSso } */
export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/enterprise/sso",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => {
    await setSsoEnforcement(ctx, orgId, await body(req, enforceInput));
    return { ok: true };
  },
);
