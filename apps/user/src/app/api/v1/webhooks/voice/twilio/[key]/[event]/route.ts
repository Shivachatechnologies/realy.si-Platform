import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse } from "@/server/core/http";
import { handleTwilioVoiceHook } from "@/server/modules/voice/twilio";

const MAX_BODY = 64 * 1024;

/**
 * Twilio Programmable Voice webhooks (inbound / outbound TwiML, status, recording, real-time transcription).
 * Server-to-server: no session or Origin, so not wrapped in route(). Authenticity comes solely from X-Twilio-Signature
 * over the exact public URL (incl. query) and form fields, verified with the company's Twilio auth token.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string; event: string }> }) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return new Response(null, { status: 413 });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return new Response(null, { status: 413 });
    const form = Object.fromEntries(new URLSearchParams(raw));
    const { key, event } = await ctx.params;
    const r = await handleTwilioVoiceHook(key, event, req.nextUrl.search, form, req.headers.get("x-twilio-signature"));
    return new Response(r.twiml, { status: r.status, headers: { "content-type": "text/xml; charset=utf-8", "x-request-id": requestId } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
