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
import { processApp } from "./observability";
import { requestGate } from "./platform-controls";
import { ensurePlatformSecretsFresh } from "./platform-secrets";
import { SESSION_COOKIE, validateSessionToken, type SessionInfo } from "@/server/modules/auth/session";
import { after } from "next/server";

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

// ───────────────────────────── Request and error hooks (stream E; docs/admin/hooks.md) ─────────────────────────────
//
// Two process-wide observer lists that every `route()` handler feeds:
//   onRequestComplete(fn)  once per handled request, after the response is built (status, duration, actor, route)
//   onError(fn)            once per unexpected server error (status >= 500: unhandled exceptions and database
//                          failures); expected AppErrors (4xx, validation, rate limits) never reach it
// Both run AFTER the response (Next.js `after()`, or a detached promise outside a request scope), never delay it, and
// can never break a request: a throwing or rejecting hook is swallowed. Hook events carry only metadata — never
// headers, cookies, bodies or query strings. The lists live on globalThis because a server process holds one copy of
// this module per route bundle.
//
// A third list, onRequestGate(fn), runs BEFORE the handler and may refuse the request by throwing (B: impersonation).
//
// Who registers: each stream owns one installer in core/request-hooks/<stream>.ts (E: error grouping and the app log
// sink; B: impersonation gate and per-request attribution; F: the API request log). core/request-hooks/index.ts runs them once per process, lazily on the first request,
// and the worker calls installHooks("worker") at start. Call `reportServerError` from places outside `route()` that
// catch server errors themselves (instrumentation.ts onRequestError for pages and server actions).

/** Metadata of one handled API request (no headers, cookies, bodies or query strings). */
export interface RequestCompleteEvent {
  requestId: string;
  /** Process: "user" (app.realy.si), "admin" (Control Center) or "worker" (core/observability.ts processApp). */
  app: string;
  method: string;
  /** Route template (`opts.name`), e.g. "POST /organizations/:orgId/companies". */
  route: string;
  /** Request path without the query string. */
  path: string;
  status: number;
  durationMs: number;
  startedAt: Date;
  /** Error code of the envelope when status >= 400 ("validation_error", "rate_limited", "internal_error"…). */
  errorCode: string | null;
  actorType: string | null;
  actorId: string | null;
  sessionId: string | null;
  /** Authenticated with a developer API key (Authorization: Bearer rly_…). */
  apiKey: boolean;
  /** Tenant from the path (/api/v1/organizations/<id>/…) or the API key's organization. */
  organizationId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** An unexpected server error (status >= 500). `error` is the original thrown value: scrub before storing it. */
export interface RequestErrorEvent {
  requestId: string | null;
  app: string;
  /** "unhandled" exception, "database" failure, or "render" (pages / server actions via reportServerError). */
  kind: "unhandled" | "database" | "render";
  error: unknown;
  method: string | null;
  route: string | null;
  path: string | null;
  status: number;
  actorType: string | null;
  actorId: string | null;
  organizationId: string | null;
}

/** Input of a request gate: runs BEFORE the handler, after authentication and the platform gate. */
export interface RequestGateEvent {
  requestId: string;
  app: string;
  method: string;
  /** Request path without the query string. */
  pathname: string;
  route: string;
  /** Session id of a cookie-authenticated request; null for API keys and anonymous requests. */
  sessionId: string | null;
  ctx: RequestContext;
}

/** May throw an AppError to refuse the request (the error envelope is returned; the handler never runs). */
export type RequestGateHook = (event: RequestGateEvent) => void | Promise<void>;

export type RequestCompleteHook = (event: RequestCompleteEvent) => void | Promise<void>;
export type RequestErrorHook = (event: RequestErrorEvent) => void | Promise<void>;

const hookStore = globalThis as unknown as { realyHttpHooks?: { complete: Set<RequestCompleteHook>; error: Set<RequestErrorHook>; gate: Set<RequestGateHook>; installing?: Promise<void>; installed?: boolean } };
const hooks = () => {
  const h = (hookStore.realyHttpHooks ??= { complete: new Set(), error: new Set(), gate: new Set() });
  h.gate ??= new Set();
  return h;
};

/**
 * Gate every request before its handler runs (e.g. stream B's impersonation read-only gate). Unlike the observer
 * hooks this one can refuse a request by throwing an AppError, and it runs on the request path: keep it cheap
 * (no I/O for the common case; at most one cached lookup). Returns an unsubscribe function.
 */
export function onRequestGate(fn: RequestGateHook): () => void {
  hooks().gate.add(fn);
  return () => void hooks().gate.delete(fn);
}

/** Observe every handled request. Returns an unsubscribe function. Register from core/request-hooks/<stream>.ts. */
export function onRequestComplete(fn: RequestCompleteHook): () => void {
  hooks().complete.add(fn);
  return () => void hooks().complete.delete(fn);
}

/** Observe every unexpected server error (status >= 500). Returns an unsubscribe function. */
export function onError(fn: RequestErrorHook): () => void {
  hooks().error.add(fn);
  return () => void hooks().error.delete(fn);
}

/** Run work after the response: `after()` inside a request scope, a detached promise elsewhere (tests, scripts). */
function afterResponse(work: () => Promise<void>) {
  try {
    after(work);
  } catch {
    void work();
  }
}

async function runHooks<E>(list: Set<(e: E) => void | Promise<void>>, event: E) {
  for (const fn of [...list]) {
    try {
      await fn(event);
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, "http hook failed");
    }
  }
}

/** Install every stream's hooks once per process (lazy: route bundles that never serve a request pay nothing). */
function ensureHooksInstalled(): Promise<void> {
  const h = hooks();
  h.installing ??= import("./request-hooks")
    .then((m) => m.installHooks(processApp()))
    .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "request hooks install failed"))
    .finally(() => {
      h.installed = true;
    });
  return h.installing;
}

/**
 * Report a server error caught outside `route()` (instrumentation onRequestError: pages, server actions). Never
 * throws; the hooks run after the response.
 */
export function reportServerError(error: unknown, meta: { requestId?: string | null; method?: string | null; route?: string | null; path?: string | null; kind?: RequestErrorEvent["kind"] } = {}) {
  const event: RequestErrorEvent = {
    requestId: meta.requestId ?? null,
    app: processApp(),
    kind: meta.kind ?? "render",
    error,
    method: meta.method ?? null,
    route: meta.route ?? null,
    path: meta.path ?? null,
    status: 500,
    actorType: null,
    actorId: null,
    organizationId: null,
  };
  afterResponse(async () => {
    await ensureHooksInstalled();
    await runHooks(hooks().error, event);
  });
}

/** The error envelope's code and HTTP status for a thrown value (same mapping as errorResponse, no side effects). */
function classify(err: unknown): { status: number; code: string; kind: RequestErrorEvent["kind"] | null } {
  if (err instanceof ZodError) return { status: 400, code: "validation_error", kind: null };
  if (isAppError(err)) return { status: err.status, code: err.code, kind: err.status >= 500 ? "unhandled" : null };
  const d = databaseError(err);
  if (d) return { status: d.status, code: d.code, kind: d.status >= 500 ? "database" : null };
  return { status: 500, code: "internal_error", kind: "unhandled" };
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
    const startedAt = new Date();
    const hooksReady = ensureHooksInstalled();
    // Filled in as the request is authenticated; read by the request hooks after the response.
    const seen: { ctx: RequestContext | null; session: SessionInfo | null; apiKey: boolean; orgId: string | null; failure: { err: unknown; code: string; kind: RequestErrorEvent["kind"] | null } | null } = { ctx: null, session: null, apiKey: false, orgId: null, failure: null };
    return withSpan("http.server.request", { "http.method": req.method, "http.route": name, "realy.request_id": requestId }, async (span) => {
      let limitResult: RateLimitResult | null = null;
      let idempotencyId: string | null = null;
      const finish = (res: Response) => {
        res.headers.set("x-request-id", requestId);
        if (limitResult) for (const [k, v] of Object.entries(rateLimitHeaders(limitResult))) res.headers.set(k, v);
        span.setAttribute("http.status_code", res.status);
        const h = hooks();
        if (!h.installed || h.complete.size || h.error.size) {
          const status = res.status;
          const durationMs = Date.now() - startedAt.getTime();
          afterResponse(async () => {
            await hooksReady;
            const app = processApp();
            const actorType = seen.ctx?.actor.type ?? null;
            const actorId = seen.ctx?.actor.id ?? seen.session?.userId ?? null;
            const orgId = seen.orgId ?? /^\/api\/v1\/organizations\/([0-9a-f-]{36})(?:\/|$)/.exec(req.nextUrl.pathname)?.[1] ?? null;
            await runHooks(hooks().complete, {
              requestId,
              app,
              method: req.method,
              route: name,
              path: req.nextUrl.pathname,
              status,
              durationMs,
              startedAt,
              errorCode: seen.failure?.code ?? null,
              actorType,
              actorId,
              sessionId: seen.session?.id ?? null,
              apiKey: seen.apiKey,
              organizationId: orgId,
              ip: clientIp(req),
              userAgent: req.headers.get("user-agent"),
            });
            if (seen.failure?.kind) {
              await runHooks(hooks().error, { requestId, app, kind: seen.failure.kind, error: seen.failure.err, method: req.method, route: name, path: req.nextUrl.pathname, status, actorType, actorId, organizationId: orgId });
            }
          });
        }
        return res;
      };
      try {
        // Admin-set platform keys (docs/platform-keys.md): no I/O unless the ~30 s TTL expired; never throws.
        await ensurePlatformSecretsFresh();
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
          seen.apiKey = true;
          seen.orgId = principal.organizationId;
        } else if (opts.auth !== "none") {
          session = await validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
          if (!session) throw new AppError("unauthenticated", "Sign in required");
          seen.session = session;
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
        seen.ctx = ctx;

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

        // Request gates (core/request-hooks/<stream>.ts): the first request of a process waits for installation once.
        await hooksReady;
        const gates = hooks().gate;
        if (gates.size) {
          const gateEvent: RequestGateEvent = { requestId, app: processApp(), method: req.method, pathname: req.nextUrl.pathname, route: name, sessionId: session?.id ?? null, ctx };
          for (const gate of [...gates]) await gate(gateEvent);
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
        seen.failure = { err, ...classify(err) };
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
