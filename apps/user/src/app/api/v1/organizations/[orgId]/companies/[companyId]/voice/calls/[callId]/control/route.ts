import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { controlCall, controlInput } from "@/server/modules/voice/live";

type P = { orgId: string; companyId: string; callId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/calls/:callId/control", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, callId }) => controlCall(ctx, orgId, companyId, callId, await body(req, controlInput)),
);
