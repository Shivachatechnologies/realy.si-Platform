import "server-only";
import type { NextRequest } from "next/server";
import { newRequestId } from "@/server/core/context";
import { clientIpFrom, errorResponse, json } from "@/server/core/http";
import { AppError } from "@/server/core/errors";
import { consume, mostRestrictive, rateLimitHeaders, type RateLimitResult, type RateLimitRule } from "@/server/core/rate-limit";
import { requestGate } from "@/server/core/platform-controls";
import { securityEvent } from "@/server/core/telemetry";
import { sha256 } from "@/server/core/crypto";
import { allowedOriginFor, keySchema } from "./public";
import { appOrigin } from "./settings";

/**
 * Cross-origin wrapper for the public chat API (/api/public/chat/*). The standard route() refuses cross-origin
 * mutations (CSRF defense for cookie sessions); this API uses no cookies at all, so instead every request must come from
 * an origin on the widget key's allow-list, and CORS headers are returned only for that origin. Per-IP, per-key and
 * per-visitor rate limits bound abuse and AI cost; platform maintenance applies.
 */

const MAX_BODY = 16 * 1024;

export interface PublicLimit extends RateLimitRule {
  by: "ip" | "key" | "visitor";
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export async function preflight(req: NextRequest): Promise<Response> {
  const origin = req.headers.get("origin");
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!origin || !keySchema.safeParse(key).success || !(await allowedOriginFor(key, origin))) return new Response(null, { status: 204, headers: { vary: "Origin" } });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export interface PublicArgs {
  req: NextRequest;
  key: string;
  origin: string | null;
  ip: string | null;
  body: Record<string, unknown>;
  requestId: string;
}

export async function publicChat(req: NextRequest, opts: { name: string; limits: PublicLimit[] }, handler: (a: PublicArgs) => Promise<unknown>): Promise<Response> {
  const requestId = newRequestId(req.headers.get("x-request-id"));
  // Same-origin GETs (settings preview inside the app) carry no Origin header; Sec-Fetch-Site can't be set by scripts.
  const origin = req.headers.get("origin") ?? (req.headers.get("sec-fetch-site") === "same-origin" ? appOrigin() : null);
  const key = req.nextUrl.searchParams.get("key") ?? "";
  let limit: RateLimitResult | null = null;
  let cors: Record<string, string> = { vary: "Origin" };
  const finish = (res: Response) => {
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    if (limit) for (const [k, v] of Object.entries(rateLimitHeaders(limit))) res.headers.set(k, v);
    res.headers.set("x-request-id", requestId);
    res.headers.set("cache-control", "no-store");
    return res;
  };
  try {
    if (!keySchema.safeParse(key).success) throw new AppError("not_found", "Chat not found");
    // Browsers always send Origin on cross-origin and POST requests; a missing Origin is refused.
    if (!origin || !(await allowedOriginFor(key, origin))) {
      securityEvent("livechat.origin_rejected", { route: opts.name });
      throw new AppError("forbidden", "This website is not allowed to use this chat", { reason: "livechat_origin_not_allowed" });
    }
    cors = corsHeaders(origin);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > MAX_BODY) throw new AppError("payload_too_large", "Request too large");
      const text = await req.text();
      if (Buffer.byteLength(text) > MAX_BODY) throw new AppError("payload_too_large", "Request too large");
      try {
        const parsed = JSON.parse(text || "{}") as unknown;
        body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      } catch {
        throw new AppError("validation_error", "Request body must be JSON");
      }
    }
    const ip = clientIpFrom(req.headers);
    const results: RateLimitResult[] = [];
    for (const rule of opts.limits) {
      const visitor = typeof body.visitorToken === "string" ? sha256(body.visitorToken).slice(0, 32) : null;
      const subject = rule.by === "ip" ? (ip ?? "no-ip") : rule.by === "key" ? key : visitor;
      if (subject) results.push(await consume(rule, subject));
    }
    limit = mostRestrictive(results);
    if (limit && !limit.allowed) {
      if (limit.degraded) throw new AppError("service_unavailable", "Temporarily unavailable, please retry shortly");
      securityEvent("rate_limit.exceeded", { route: opts.name });
      throw new AppError("rate_limited", "Too many requests");
    }
    await requestGate({ pathname: req.nextUrl.pathname, method: req.method, userId: null, serviceAccountOrgId: null });
    const result = await handler({ req, key, origin, ip, body, requestId });
    return finish(json(result ?? { ok: true }, { status: 200, requestId }));
  } catch (err) {
    return finish(errorResponse(err, requestId));
  }
}
