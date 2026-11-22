import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { ensurePlatformSecretsFresh } from "@/server/core/platform-secrets";
import { errorResponse, json } from "@/server/core/http";
import { isEmailWebhookProvider, receiveEmailWebhook } from "@/server/modules/email/events";

const MAX_BODY = 256 * 1024;

/**
 * Platform email provider events (Resend: Svix signature; Postmark: Basic credentials on the URL): delivery, bounce,
 * complaint, open, click → `email_events`; hard bounces and complaints → `email_suppressions` (Admin → Email).
 * Server-to-server: unsigned or wrongly signed requests answer 401, an unset secret 501. Never echoes the payload.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    const { provider } = await ctx.params;
    if (!isEmailWebhookProvider(provider)) return json({ error: { code: "not_found", message: "Unknown provider", requestId } }, { status: 404, requestId });
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large", requestId } }, { status: 413, requestId });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return json({ error: { code: "payload_too_large", requestId } }, { status: 413, requestId });
    // Admin-set platform keys (the webhook secrets live there): cheap unless the TTL expired.
    await ensurePlatformSecretsFresh();
    const r = await receiveEmailWebhook(provider, raw, req.headers);
    return json({ ok: true, stored: r.stored }, { status: 200, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
