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
import { requestGate } from "./platform-controls";
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
  const db = databaseError(err);
  if (db) {
    logger.error({ err, requestId, prismaCode: db.prismaCode }, "database error");
    captureException(err, { requestId });
    return json({ error: { code: db.code, message: db.message, requestId, details: { reason: db.reason } } }, { status: db.status, requestId });
  }
  logger.error({ err, requestId }, "unhandled error");
  captureException(err, { requestId });
  return json({ error: { code: "internal_error", message: "Something went wrong", requestId } }, { status: 500, requestId });
}

/**
 * Operator-actionable database failures (missing migrations, unreachable database, unique conflicts) get a specific
 * code and reason instead of a generic 500. Messages name the fix, never connection strings or query text.
 */
function databaseError(err: unknown): { status: number; code: "conflict" | "service_unavailable" | "not_configured"; reason: string; message: string; prismaCode?: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; name?: unknown; errorCode?: unknown };
  const code = typeof e.code === "string" ? e.code : typeof e.errorCode === "string" ? e.errorCode : "";
  const name = typeof e.name === "string" ? e.name : "";
  if (code === "P2021" || code === "P2022") {
    return { status: 503, code: "not_configured", reason: "database_not_migrated", message: "The database schema is not up to date. Run `prisma migrate deploy` against this database.", prismaCode: code };
  }
  if (code === "P2002") return { status: 409, code: "conflict", reason: "duplicate", message: "A record with these details already exists.", prismaCode: code };
  if (["P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1017", "P2024"].includes(code) || name === "PrismaClientInitializationError") {
    return { status: 503, code: "service_unavailable", reason: "database_unavailable", message: "The database is unreachable. Check DATABASE_URL and that the database accepts connections.", prismaCode: code || name };
  }
  return null;
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

function limitSubject(by: LimitKey, req: NextRequest, ip: string | null, session: SessionInfo | null, principalId: string | null): string | null {
  if (by === "ip") return ip ?? "no-ip";
  if (by === "principal") return principalId ?? session?.userId ?? null;
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
        // Developer API keys (Authorization: Bearer rly_…, docs/api.md): bearer credentials are not sent by browsers on
        // their own, so the cookie CSRF check does not apply; the key's service account carries exactly its scopes.
        const apiKeyAuth = opts.auth !== "none" && /^Bearer rly_/i.test(req.headers.get("authorization") ?? "");
        if (mutating && !apiKeyAuth && !sameOrigin(req)) {
          securityEvent("csrf.origin_rejected", { route: name });
          throw new AppError("forbidden", "Cross-origin request refused");
        }
        if (mutating) rawBodies.set(req, await readBody(req, opts.maxBodyBytes ?? DEFAULT_MAX_BODY));

        const ip = clientIp(req);
        let session: SessionInfo | null = null;
        let apiCtx: RequestContext | null = null;
        let apiKeyOrgId: string | null = null;
        if (apiKeyAuth) {
          const { authenticateApiKey } = await import("@/server/modules/enterprise/api-keys");
          const principal = await authenticateApiKey(req.headers, { requestId, ip, userAgent: req.headers.get("user-agent") });
          apiCtx = principal.ctx;
          apiKeyOrgId = principal.organizationId;
        } else if (opts.auth !== "none") {
          session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
          if (!session) throw new AppError("unauthenticated", "Sign in required");
          if (session.mfaPending && opts.auth === "required") throw new AppError("mfa_required", "Complete two-factor verification");
        }

        if (opts.rateLimits?.length) {
          const results: RateLimitResult[] = [];
          for (const rule of opts.rateLimits) {
            const subject = limitSubject(rule.by, req, ip, session, apiCtx?.actor.id ?? null);
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
        const ctx: RequestContext = apiCtx
          ? apiCtx
          : session
          ? userContext(session.userId, { requestId, ip, userAgent, sessionId: session.id, mfaVerifiedAt: session.mfaVerifiedAt })
          : { requestId, actor: { type: "USER", id: null }, mfaVerifiedAt: null, sessionId: null, ip, userAgent };

        // Organization security policy (require MFA, session timeout, IP allowlist) for members on org-scoped APIs.
        const orgMatch = /^\/api\/v1\/organizations\/([0-9a-f-]{36})(?:\/|$)/.exec(req.nextUrl.pathname);
        if (orgMatch && session && ctx.actor.type === "USER" && ctx.actor.id) {
          const { assertOrgAccess } = await import("@/server/modules/enterprise/policy");
          await assertOrgAccess(ctx, orgMatch[1]!);
        }
        // Platform controls (Admin → Platform Controls): maintenance, read-only, suspended organizations, disabled
        // modules and plan API quota. Admin API is exempt; platform admins pass maintenance and read-only.
        await requestGate({ pathname: req.nextUrl.pathname, method: req.method, userId: session?.userId ?? null, serviceAccountOrgId: apiKeyOrgId });
        // Plan entitlements (docs/entitlements.md): routes mapped to a plan feature answer plan_feature_locked when the
        // organization's plan lacks it. Runs after the platform gate; no effect when the feature is included.
        if ((session || apiCtx) && req.nextUrl.pathname.startsWith("/api/v1/organizations/")) {
          const { entitlementApiGate } = await import("@/server/modules/entitlements/gate");
          await entitlementApiGate({ pathname: req.nextUrl.pathname, method: req.method });
        }

        const idemKey = req.headers.get("idempotency-key");
        const principalId = apiCtx?.actor.id ?? session?.userId ?? null;
        if (opts.idempotent && idemKey && mutating && principalId) {
          const claim = await claimIdempotencyKey({
            principalId,
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
