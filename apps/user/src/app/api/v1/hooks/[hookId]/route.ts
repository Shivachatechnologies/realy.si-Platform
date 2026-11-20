import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { clientIp, errorResponse, json } from "@/server/core/http";
import { receiveHook } from "@/server/modules/integrations/webhooks";

const MAX_BODY = 256 * 1024;

/**
 * Incoming webhooks (Integrations OS). Server-to-server: no session and no Origin, so not wrapped in route().
 * Authenticity comes solely from the hook's secret token or HMAC signature, verified over the exact raw body.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/v1/hooks/[hookId]">) {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  try {
    const { hookId } = await ctx.params;
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return json({ error: { code: "payload_too_large" } }, { status: 413, requestId });
    const raw = await req.text();
    const result = await receiveHook(hookId, raw, req.headers, req.nextUrl.searchParams, clientIp(req));
    return json(result.body, { status: result.status, requestId });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
