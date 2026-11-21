import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { receiveProviderWebhook, type ProviderWebhookResult } from "@/server/modules/integrations/provider-webhooks";

const MAX_BODY = 512 * 1024;
type Ctx = RouteContext<"/api/v1/integrations/webhooks/[provider]/[connectionId]/[token]">;

/**
 * Provider webhooks & status callbacks (Calendly, Twilio, Plaid, WhatsApp, render / generation callbacks...).
 * Server-to-server: no session, so not wrapped in route(). Authenticity: the connection's unguessable URL token plus
 * the provider's own signature where it signs (verified over the exact raw body in provider-webhooks.ts).
 */
function respond(r: ProviderWebhookResult, requestId: string) {
  if (r.text) return new Response(String(r.body), { status: r.status, headers: { "content-type": "text/plain; charset=utf-8", "x-request-id": requestId } });
  return json(r.body as Record<string, unknown>, { status: r.status, requestId });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    const { provider, connectionId, token } = await ctx.params;
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    return respond(await receiveProviderWebhook(provider, connectionId, token, "POST", raw, req.headers, req.nextUrl.searchParams), requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

/** Meta's subscription handshake (hub.challenge). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    const { provider, connectionId, token } = await ctx.params;
    return respond(await receiveProviderWebhook(provider, connectionId, token, "GET", "", req.headers, req.nextUrl.searchParams), requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
