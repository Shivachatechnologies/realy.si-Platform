import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { handleMetaVerify, handleMetaWebhook } from "@/server/modules/briefing/inbound";

const MAX_BODY = 256 * 1024;
type Ctx = { params: Promise<{ key: string }> };

/** WhatsApp Cloud API webhook verification handshake (hub.mode / hub.verify_token / hub.challenge). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { key } = await params;
  const r = await handleMetaVerify(key, req.nextUrl.searchParams);
  return new Response(r.body, { status: r.status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * WhatsApp Cloud API replies to the founder briefing. Server-to-server: authenticity comes from X-Hub-Signature-256
 * (HMAC-SHA256 of the raw body with the Meta app secret stored for the company).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const { key } = await params;
    const r = await handleMetaWebhook(key, raw, req.headers.get("x-hub-signature-256"));
    return json({ ok: r.status === 200 }, { status: r.status, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
