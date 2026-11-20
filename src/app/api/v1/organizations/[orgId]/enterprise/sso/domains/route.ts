import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addDomain, domainInput } from "@/server/modules/enterprise/sso";

export const POST = route<{ orgId: string }>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/enterprise/sso/domains",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
  },
  async ({ req, ctx }, { orgId }) => addDomain(ctx, orgId, await body(req, domainInput)),
);
