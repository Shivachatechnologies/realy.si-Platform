import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { utter, utterInput } from "@/server/modules/voiceos/service";

type P = { orgId: string; companyId: string; sessionId: string };

/** POST — route one utterance into AI Command (a real run, delegated to AI employees). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voiceos/sessions/:id/utterances", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, sessionId }) => utter(ctx, orgId, companyId, sessionId, await body(req, utterInput)),
);
