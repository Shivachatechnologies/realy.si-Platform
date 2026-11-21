import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { removeDoNotCall } from "@/server/modules/voice/service";

type P = { orgId: string; companyId: string; entryId: string };

export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/voice/dnc/:entryId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, entryId }) => removeDoNotCall(ctx, orgId, companyId, entryId),
);
