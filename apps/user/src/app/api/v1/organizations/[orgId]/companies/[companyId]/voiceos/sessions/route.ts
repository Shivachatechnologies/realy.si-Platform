import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { clearVoiceHistory, startSessionInput, startVoiceSession } from "@/server/modules/voiceos/service";

type P = { orgId: string; companyId: string };

/** POST — start a voice conversation (ends the viewer's previous active one). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voiceos/sessions", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => startVoiceSession(ctx, orgId, companyId, await body(req, startSessionInput)),
);
/** DELETE — erase every stored voice transcript of the viewer in this company. */
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/voiceos/sessions", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId }) => clearVoiceHistory(ctx, orgId, companyId),
);
