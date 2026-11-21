import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteVoiceSession, endVoiceSession, getVoiceSession } from "@/server/modules/voiceos/service";

type P = { orgId: string; companyId: string; sessionId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, sessionId }) => getVoiceSession(ctx, orgId, companyId, sessionId));
/** PATCH — end the conversation (no body). */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/voiceos/sessions/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, sessionId }) => endVoiceSession(ctx, orgId, companyId, sessionId),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/voiceos/sessions/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, sessionId }) => deleteVoiceSession(ctx, orgId, companyId, sessionId),
);
