import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { errorResponse, json } from "@/server/core/http";
import { handleEmailWebhook } from "@/server/modules/marketing/deliverability";

const MAX_BODY = 2 * 1024 * 1024;

/**
 * Email provider event webhooks (sendgrid / mailchimp): bounces, complaints, unsubscribes, opens, clicks. Not wrapped in
 * route(): server-to-server, no Origin; authenticity comes from the provider signature over the raw body.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string; companyId: string }> }) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    const { provider, companyId } = await ctx.params;
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const r = await handleEmailWebhook(provider, companyId, { url: req.url, rawBody, headers: req.headers });
    return json(r, { status: r.ok ? 200 : 401, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
