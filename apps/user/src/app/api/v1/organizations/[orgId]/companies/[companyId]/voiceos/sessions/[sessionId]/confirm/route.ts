import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { confirmApproval, confirmInput } from "@/server/modules/voiceos/service";

type P = { orgId: string; companyId: string; sessionId: string };

/** POST — approve or reject an approval raised by this conversation's work (clicked, or an explicit spoken phrase). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voiceos/sessions/:id/confirm", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, sessionId }) => confirmApproval(ctx, orgId, companyId, sessionId, await body(req, confirmInput)),
);
