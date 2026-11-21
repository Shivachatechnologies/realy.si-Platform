import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { retryCall, retryInput } from "@/server/modules/voice/live";

type P = { orgId: string; companyId: string; callId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/calls/:callId/retry", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, callId }) => retryCall(ctx, orgId, companyId, callId, await body(req, retryInput)),
);
