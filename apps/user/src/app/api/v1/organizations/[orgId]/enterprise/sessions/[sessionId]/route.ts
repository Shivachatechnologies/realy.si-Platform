import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { revokeMemberSession } from "@/server/modules/enterprise/policy";

type P = { orgId: string; sessionId: string };

export const DELETE = route<P>(
  {
    auth: "required",
    name: "DELETE /organizations/:orgId/enterprise/sessions/:sessionId",
    rateLimits: LIMITS.tenantWrite,
  },
  async ({ ctx }, { orgId, sessionId }) => {
    await revokeMemberSession(ctx, orgId, sessionId);
    return { ok: true };
  },
);
