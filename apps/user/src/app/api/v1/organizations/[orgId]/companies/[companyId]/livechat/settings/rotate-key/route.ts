import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { rotatePublicKey } from "@/server/modules/livechat/settings";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/livechat/settings/rotate-key", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId }) => rotatePublicKey(ctx, orgId, companyId),
);
