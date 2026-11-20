import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { revokeApiKey } from "@/server/modules/enterprise/api-keys";

type P = { orgId: string; keyId: string };

export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/enterprise/api-keys/:keyId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, keyId }) => {
    await revokeApiKey(ctx, orgId, keyId);
    return { ok: true };
  },
);
