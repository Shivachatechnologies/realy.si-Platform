import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { logger } from "@/server/core/logger";
import { handleRoutedWhatsAppMessages } from "@/server/modules/briefing/inbound";
import { receiveWhatsAppAppWebhook, verifyWhatsAppAppSubscription, type RoutedResult } from "@/server/modules/integrations/own-account-webhooks";

const MAX_BODY = 1024 * 1024;

function respond(r: RoutedResult, requestId: string) {
  if (r.text) return new Response(String(r.body), { status: r.status, headers: { "content-type": "text/plain; charset=utf-8", "x-request-id": requestId } });
  return json(r.body as Record<string, unknown>, { status: r.status, requestId });
}

/** Meta's subscription handshake for Realy's app-level WhatsApp callback URL (WHATSAPP_WEBHOOK_VERIFY_TOKEN). */
export async function GET(req: NextRequest) {
  return respond(verifyWhatsAppAppSubscription(req.nextUrl.searchParams), newRequestId(req.headers.get("x-request-id")));
}

/**
 * WhatsApp Business webhooks of every customer connected with Embedded Signup on Realy's Meta app: verified with
 * WHATSAPP_APP_SECRET, split and routed to the company that owns each phone_number_id (docs/integrations.md §7).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    const { result, routed } = await receiveWhatsAppAppWebhook(raw, req.headers.get("x-hub-signature-256"));
    for (const r of routed) {
      // Consumers of inbound messages (briefing replies); a failure here must not make Meta redeliver stored events.
      await handleRoutedWhatsAppMessages(r.organizationId, r.companyId, r.body).catch((err: unknown) => logger.warn({ companyId: r.companyId, err: err instanceof Error ? err.message : "failed" }, "routed whatsapp message handling failed"));
    }
    return respond(result, requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
