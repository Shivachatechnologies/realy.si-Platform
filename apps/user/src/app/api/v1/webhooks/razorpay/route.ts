import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { receiveRazorpayPartnerWebhook } from "@/server/modules/integrations/own-account-webhooks";

const MAX_BODY = 1024 * 1024;

/**
 * Razorpay partner webhooks: events of the customers' OWN Razorpay accounts connected through Realy's partner app,
 * routed to the company by `account_id` (docs/integrations.md §7). Server-to-server: authenticity comes solely from
 * X-Razorpay-Signature (HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET).
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    const r = await receiveRazorpayPartnerWebhook(raw, req.headers.get("x-razorpay-signature"));
    return json(r.body as Record<string, unknown>, { status: r.status, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
