import "server-only";
import type { NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { AppError, isAppError } from "./errors";
import { newRequestId, userContext, type RequestContext } from "./context";
import { jsonStringify } from "./json";
import { logger } from "./logger";
import { env } from "./env";
import { rateLimit } from "./rate-limit";
import { SESSION_COOKIE, validateSessionToken, type SessionInfo } from "@/server/modules/auth/session";

export interface HandlerArgs {
  req: NextRequest;
  ctx: RequestContext;
  session: SessionInfo | null;
  requestId: string;
}

interface RouteOptions {
  /** required: signed-in, MFA complete. mfa-pending: signed-in, MFA may be pending. none: public. */
  auth: "required" | "mfa-pending" | "none";
  /** Per-IP limit for this route, e.g. sign-in. */
  rateLimit?: { name: string; limit: number; windowMs: number };
}

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
  return json({ error: { code: "internal_error", message: "Something went wrong", requestId } }, { status: 500, requestId });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** CSRF defense for cookie-authenticated mutations: the Origin must be this app. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    const o = new URL(origin);
    return o.host === host || o.origin === new URL(env().APP_URL).origin;
  } catch {
    return false;
  }
}

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/**
 * Wrap a route handler with Realy's API conventions (docs/api.md): request ids, authentication,
 * CSRF origin checks, rate limits and the structured error envelope.
 */
export function route<P = unknown>(opts: RouteOptions, handler: (args: HandlerArgs, params: P) => Promise<unknown>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const requestId = newRequestId(req.headers.get("x-request-id"));
    try {
      if (MUTATING.has(req.method) && !sameOrigin(req)) {
        throw new AppError("forbidden", "Cross-origin request refused");
      }
      const ip = clientIp(req);
      if (opts.rateLimit) {
        const rl = await rateLimit(`${opts.rateLimit.name}:${ip ?? "unknown"}`, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!rl.allowed) {
          const res = errorResponse(new AppError("rate_limited", "Too many requests"), requestId);
          res.headers.set("retry-after", String(rl.resetSeconds));
          return res;
        }
      }
      let session: SessionInfo | null = null;
      if (opts.auth !== "none") {
        session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
        if (!session) throw new AppError("unauthenticated", "Sign in required");
        if (session.mfaPending && opts.auth === "required") throw new AppError("mfa_required", "Complete two-factor verification");
      }
      const userAgent = req.headers.get("user-agent");
      // Anonymous requests get a USER actor with no id: RBAC denies it everything; it is never SYSTEM.
      const ctx: RequestContext = session
        ? userContext(session.userId, { requestId, ip, userAgent, sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt })
        : { requestId, actor: { type: "USER", id: null }, mfaVerifiedAt: null, sessionId: null, ip, userAgent };
      const result = await handler({ req, ctx, session, requestId }, await routeCtx.params);
      if (result instanceof Response) {
        result.headers.set("x-request-id", requestId);
        return result;
      }
      return json(result ?? { ok: true }, { status: 200, requestId });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

/**
 * Parse the JSON body and validate it early (fail fast with a 400). Returns the *input* shape:
 * domain services parse it again and are the single source of typed, transformed values.
 */
export async function body<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.input<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("validation_error", "Request body must be JSON");
  }
  schema.parse(raw);
  return raw as z.input<T>;
}
