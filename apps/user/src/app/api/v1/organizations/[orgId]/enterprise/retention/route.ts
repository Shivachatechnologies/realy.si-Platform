import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { retentionInput, updateRetention } from "@/server/modules/enterprise/policy";

type P = { orgId: string };

export const PUT = route<P>(
  {
    auth: "required",
    name: "PUT /organizations/:orgId/enterprise/retention",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ req, ctx }, { orgId }) => {
    await updateRetention(ctx, orgId, await body(req, retentionInput));
    return { ok: true };
  },
);
