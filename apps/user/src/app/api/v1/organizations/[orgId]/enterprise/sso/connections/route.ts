import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { connectionInput, createConnection } from "@/server/modules/enterprise/sso";

export const POST = route<{ orgId: string }>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/enterprise/sso/connections",
    rateLimits: LIMITS.tenantWrite,
    maxBodyBytes: 256 * 1024,
  },
  async ({ req, ctx }, { orgId }) => createConnection(ctx, orgId, await body(req, connectionInput)),
);
