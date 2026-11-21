import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse } from "@/server/core/http";
import { handleTwilioWebhook } from "@/server/modules/briefing/inbound";

const MAX_BODY = 64 * 1024;

/**
 * Twilio WhatsApp replies to the founder briefing ("approve 3"). Server-to-server: no session or Origin; authenticity
 * comes from X-Twilio-Signature over the exact public URL and form fields (verified with the company's auth token).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return new Response(null, { status: 413 });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return new Response(null, { status: 413 });
    const form = Object.fromEntries(new URLSearchParams(raw));
    const { key } = await params;
    const r = await handleTwilioWebhook(key, form, req.headers.get("x-twilio-signature"));
    return new Response(r.twiml, { status: r.status, headers: { "content-type": "text/xml; charset=utf-8", "x-request-id": requestId } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
