import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { utterInput } from "@/server/modules/voiceos/service";
import { utteranceStream } from "@/server/modules/voiceos/stream-answer";

type P = { orgId: string; companyId: string; sessionId: string };

export const maxDuration = 60;

/**
 * POST — one utterance, answered as a stream (application/x-ndjson): routing, then each finished sentence of a direct
 * answer while the model is still writing (sentence-by-sentence speech), then the same final result as …/utterances.
 */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voiceos/sessions/:id/stream-answer", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, sessionId }) => {
    const input = await body(req, utterInput);
    return new Response(utteranceStream(ctx, orgId, companyId, sessionId, input), {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-store, no-transform", "x-accel-buffering": "no" },
    });
  },
);
