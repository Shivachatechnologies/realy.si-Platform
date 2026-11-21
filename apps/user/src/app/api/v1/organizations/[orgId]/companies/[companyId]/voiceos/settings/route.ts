import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getVoiceSettings, settingsInput, updateVoiceSettings } from "@/server/modules/voiceos/access";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getVoiceSettings(ctx, orgId, companyId));
/** PATCH — the viewer's own Voice OS preferences (history, wake word, voice, language, providers). */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/voiceos/settings", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId }) => updateVoiceSettings(ctx, orgId, companyId, await body(req, settingsInput)),
);
