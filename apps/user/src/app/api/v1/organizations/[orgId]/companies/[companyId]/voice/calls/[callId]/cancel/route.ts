import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelCall } from "@/server/modules/voice/calls";

type P = { orgId: string; companyId: string; callId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/calls/:callId/cancel", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, callId }) => cancelCall(ctx, orgId, companyId, callId),
);
