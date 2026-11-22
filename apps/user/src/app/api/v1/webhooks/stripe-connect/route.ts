import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { receiveStripeConnectWebhook } from "@/server/modules/integrations/own-account-webhooks";

const MAX_BODY = 1024 * 1024;

/**
 * Stripe Connect webhooks: events of the customers' OWN Stripe accounts connected to Realy's platform, routed to the
 * company by the event's `account` (docs/integrations.md §7). Separate from Realy's subscription billing endpoint
 * (/api/v1/webhooks/stripe) and verified with its own secret (STRIPE_CONNECT_WEBHOOK_SECRET). Server-to-server: no
 * session, so not wrapped in route(); authenticity comes solely from Stripe-Signature over the raw body.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    const r = await receiveStripeConnectWebhook(raw, req.headers.get("stripe-signature"));
    return json(r.body as Record<string, unknown>, { status: r.status, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
