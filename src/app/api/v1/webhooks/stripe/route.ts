import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { json, errorResponse } from "@/server/core/http";
import { handleStripeWebhook } from "@/server/modules/billing/stripe-billing";

const MAX_BODY = 1024 * 1024;

/**
 * Stripe webhooks. Not wrapped in route(): there is no session or Origin (server-to-server), and the
 * signature must be verified over the exact raw body. Authenticity comes solely from Stripe-Signature.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    if (Buffer.byteLength(raw) > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const result = await handleStripeWebhook(raw, req.headers.get("stripe-signature"));
    return json(result.body, { status: result.status, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
