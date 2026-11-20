import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeDomain, verifyDomain } from "@/server/modules/enterprise/sso";

type P = { orgId: string; domainId: string };

/** Check the DNS TXT record now. */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/enterprise/sso/domains/:domainId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, domainId }) => verifyDomain(ctx, orgId, domainId),
);
export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/enterprise/sso/domains/:domainId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, domainId }) => {
    await removeDomain(ctx, orgId, domainId);
    return { ok: true };
  },
);
