import { body, route } from "@/server/core/http";
import { speakInput, synthesize } from "@/server/modules/voiceos/speech";

type P = { orgId: string; companyId: string };

export const maxDuration = 60;

/** POST — voice a reply with the company's text-to-speech provider (base64 audio), or "browser" when none is connected. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voiceos/speak", rateLimits: [{ name: "voiceos-tts:principal", limit: 60, windowMs: 60_000, by: "principal" }] },
  async ({ req, ctx }, { orgId, companyId }) => synthesize(ctx, orgId, companyId, await body(req, speakInput)),
);
