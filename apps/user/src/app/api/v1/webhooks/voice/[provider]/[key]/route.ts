import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { receiveVoiceWebhook } from "@/server/modules/voice/webhooks";

const MAX_BODY = 1024 * 1024;

/**
 * Voice provider webhooks (Vapi server messages, Retell call events). Server-to-server: no session and no Origin, so
 * not wrapped in route(). Authenticity comes solely from the provider signature (Retell, HMAC over the raw body with
 * the API key) or the shared secret (Vapi x-vapi-secret), verified in the voice module.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/v1/webhooks/voice/[provider]/[key]">) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    const { provider, key } = await ctx.params;
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const result = await receiveVoiceWebhook(provider, key, raw, req.headers);
    return json(result.body, { status: result.status, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
