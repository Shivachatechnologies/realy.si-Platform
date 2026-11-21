import { body, route } from "@/server/core/http";
import { transcribe, transcribeInput } from "@/server/modules/voiceos/speech";

type P = { orgId: string; companyId: string };

export const maxDuration = 60;

/** POST — transcribe one recorded phrase (base64) with the company's speech-to-text provider. */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/voiceos/transcribe",
    rateLimits: [{ name: "voiceos-stt:principal", limit: 90, windowMs: 60_000, by: "principal" }],
    maxBodyBytes: 6_500_000,
  },
  async ({ req, ctx }, { orgId, companyId }) => transcribe(ctx, orgId, companyId, await body(req, transcribeInput)),
);
