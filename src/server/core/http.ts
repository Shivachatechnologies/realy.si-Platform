import "server-only";
import type { NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { AppError, isAppError } from "./errors";
import { newRequestId, userContext, type RequestContext } from "./context";
import { jsonStringify } from "./json";
import { logger } from "./logger";
import { env } from "./env";
import { sha256 } from "./crypto";
import { consume, mostRestrictive, rateLimitHeaders, type RateLimitResult, type RateLimitRule } from "./rate-limit";
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey, requestHash } from "./idempotency";
import { captureException, securityEvent, withSpan } from "./telemetry";
import { SESSION_COOKIE, validateSessionToken, type SessionInfo } from "@/server/modules/auth/session";

export interface HandlerArgs {
  req: NextRequest;
  ctx: RequestContext;
  session: SessionInfo | null;
  requestId: string;
}

/** What a rate-limit bucket is keyed by. Body-derived keys are hashed (never store emails in Redis keys). */
export type LimitKey = "ip" | "principal" | "session" | { bodyField: string };

export interface RouteRateLimit extends RateLimitRule {
  by: LimitKey;
}

interface RouteOptions {
  /** required: signed-in, MFA complete. mfa-pending: signed-in, MFA may be pending. none: public. */
  auth: "required" | "mfa-pending" | "none";
  /** Route template for telemetry, idempotency scoping and logs, e.g. "POST /organizations/:orgId/companies". */
  name?: string;
  rateLimits?: RouteRateLimit[];
  /** Honor the Idempotency-Key header (mutations only). */
  idempotent?: boolean;
  /** Max request body in bytes (default 64 KiB). */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 64 * 1024;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The pre-read raw body, so rate-limit keys, idempotency hashing and the handler share one read.
const rawBodies = new WeakMap<NextRequest, string>();

export function json(body: unknown, init: ResponseInit & { requestId?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new Response(jsonStringify(body), { ...init, headers });
}

export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ZodError) {
    return json(
      { error: { code: "validation_error", message: "Invalid request", requestId, details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } },
      { status: 400, requestId },
    );
  }
  if (isAppError(err)) {
    return json({ error: { code: err.code, message: err.message, requestId, details: err.details } }, { status: err.status, requestId });
  }
  logger.error({ err, requestId }, "unhandled error");
  captureException(err, { requestId });
  return json({ error: { code: "internal_error", message: "Something went wrong", requestId } }, { status: 500, requestId });
}

/** CSRF defense for cookie-authenticated mutations: the Origin must be this app. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("host");
  try {
    const o = new URL(origin);
    return o.host === host || o.origin === new URL(env().APP_URL).origin;
  } catch {
    return false;
  }
}

/**
 * Client IP from X-Forwarded-For, trusting only the configured number of proxy hops from the right
 * (TRUSTED_PROXY_HOPS). Left-most entries are client-supplied and therefore never trusted.
 */
export function clientIpFrom(headers: Headers, trustedHops = env().TRUSTED_PROXY_HOPS): string | null {
  if (trustedHops <= 0) return null;
  const parts = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - trustedHops];
  return candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : null;
}

export const clientIp = (req: NextRequest) => clientIpFrom(req.headers);

async function readBody(req: NextRequest, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new AppError("payload_too_large", `Request body exceeds ${max} bytes`);
  const text = await req.text();
  if (Buffer.byteLength(text) > max) throw new AppError("payload_too_large", `Request body exceeds ${max} bytes`);
  return text;
}

function limitSubject(by: LimitKey, req: NextRequest, ip: string | null, session: SessionInfo | null): string | null {
  if (by === "ip") return ip ?? "no-ip";
  if (by === "principal") return session?.userId ?? null;
  if (by === "session") return session?.id ?? null;
  try {
    const value = (JSON.parse(rawBodies.get(req) || "{}") as Record<string, unknown>)[by.bodyField];
    return typeof value === "string" && value ? sha256(value.trim().toLowerCase()).slice(0, 32) : null;
  } catch {
    return null;
  }
}

/**
 * Wrap a route handler with Realy's API conventions (docs/api.md): request ids, tracing, authentication,
 * CSRF origin checks, body limits, rate limits, idempotency and the structured error envelope.
 */
export function route<P = unknown>(opts: RouteOptions, handler: (args: HandlerArgs, params: P) => Promise<unknown>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const requestId = newRequestId(req.headers.get("x-request-id"));
    const name = opts.name ?? `${req.method} ${req.nextUrl.pathname}`;
    return withSpan("http.server.request", { "http.method": req.method, "http.route": name, "realy.request_id": requestId }, async (span) => {
      let limitResult: RateLimitResult | null = null;
      let idempotencyId: string | null = null;
      const finish = (res: Response) => {
        res.headers.set("x-request-id", requestId);
        if (limitResult) for (const [k, v] of Object.entries(rateLimitHeaders(limitResult))) res.headers.set(k, v);
        span.setAttribute("http.status_code", res.status);
        return res;
      };
      try {
        const mutating = MUTATING.has(req.method);
        if (mutating && !sameOrigin(req)) {
          securityEvent("csrf.origin_rejected", { route: name });
          throw new AppError("forbidden", "Cross-origin request refused");
        }
        if (mutating) rawBodies.set(req, await readBody(req, opts.maxBodyBytes ?? DEFAULT_MAX_BODY));

        const ip = clientIp(req);
        let session: SessionInfo | null = null;
        if (opts.auth !== "none") {
          session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
          if (!session) throw new AppError("unauthenticated", "Sign in required");
          if (session.mfaPending && opts.auth === "required") throw new AppError("mfa_required", "Complete two-factor verification");
        }

        if (opts.rateLimits?.length) {
          const results: RateLimitResult[] = [];
          for (const rule of opts.rateLimits) {
            const subject = limitSubject(rule.by, req, ip, session);
            if (subject) results.push(await consume(rule, subject));
          }
          limitResult = mostRestrictive(results);
          if (limitResult && !limitResult.allowed) {
            if (limitResult.degraded) throw new AppError("service_unavailable", "Temporarily unavailable, please retry shortly");
            securityEvent("rate_limit.exceeded", { route: name });
            throw new AppError("rate_limited", "Too many requests");
          }
        }

        const userAgent = req.headers.get("user-agent");
        // Anonymous requests get a USER actor with no id: RBAC denies it everything; it is never SYSTEM.
        const ctx: RequestContext = session
          ? userContext(session.userId, { requestId, ip, userAgent, sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt })
          : { requestId, actor: { type: "USER", id: null }, mfaVerifiedAt: null, sessionId: null, ip, userAgent };

        const idemKey = req.headers.get("idempotency-key");
        if (opts.idempotent && idemKey && mutating && session) {
          const claim = await claimIdempotencyKey({
            principalId: session.userId,
            endpoint: name,
            key: idemKey,
            requestHash: requestHash(req.method, req.nextUrl.pathname, rawBodies.get(req) ?? ""),
          });
          if (claim.kind === "replay") {
            const res = json(claim.body, { status: claim.status, requestId });
            res.headers.set("idempotent-replayed", "true");
            return finish(res);
          }
          idempotencyId = claim.id;
        }

        const result = await handler({ req, ctx, session, requestId }, await routeCtx.params);
        if (result instanceof Response) {
          if (idempotencyId) await releaseIdempotencyKey(idempotencyId); // raw responses (cookies) are not replayable
          return finish(result);
        }
        const payload = result ?? { ok: true };
        if (idempotencyId) await completeIdempotencyKey(idempotencyId, 200, payload);
        return finish(json(payload, { status: 200, requestId }));
      } catch (err) {
        if (idempotencyId) await releaseIdempotencyKey(idempotencyId).catch(() => undefined);
        if (isAppError(err) && (err.code === "unauthenticated" || err.code === "forbidden")) {
          span.setAttribute("realy.auth_failure", err.code);
        }
        return finish(errorResponse(err, requestId));
      }
    });
  };
}

/**
 * Parse the (pre-read) JSON body and validate it early (fail fast with a 400). Returns the *input*
 * shape: domain services parse again and are the single source of typed, transformed values.
 */
export async function body<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.input<T>> {
  let raw: unknown;
  try {
    const text = rawBodies.has(req) ? rawBodies.get(req)! : await req.text();
    raw = JSON.parse(text || "null");
  } catch {
    throw new AppError("validation_error", "Request body must be JSON");
  }
  schema.parse(raw);
  return raw as z.input<T>;
}
