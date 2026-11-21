import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import * as Sentry from "@sentry/node";
import { logger } from "./logger";

/**
 * Observability facade (docs/security.md §9, docs/architecture.md §4).
 * - Traces: vendor-neutral OpenTelemetry API. Exported only when an OTLP endpoint is configured
 *   (see src/instrumentation.ts); otherwise the API is a no-op — nothing is faked.
 * - Errors: Sentry, only when SENTRY_DSN is configured.
 * Every attribute passes through `scrub`, so secrets and personal data never reach telemetry.
 */
export const tracer = trace.getTracer("realy");

const SENSITIVE_FRAGMENTS = ["password", "passwd", "secret", "token", "authorization", "cookie", "apikey", "api_key", "otp", "email", "signature", "mfacode", "recoverycode"];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === "code" || SENSITIVE_FRAGMENTS.some((f) => k.includes(f));
}

/** Drop sensitive keys; keep only primitive values (no nested request bodies). */
export function scrub(attrs: Record<string, unknown> = {}): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (isSensitiveKey(k)) continue;
    if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

export async function withSpan<T>(name: string, attrs: Record<string, unknown>, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: scrub(attrs) }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? { name: err.name, message: err.message } : String(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Security-relevant events (auth failures, lockouts, limiter degradation): structured log + span event. */
export function securityEvent(name: string, attrs: Record<string, unknown> = {}) {
  const safe = scrub(attrs);
  logger.warn({ securityEvent: name, ...safe }, "security event");
  trace.getActiveSpan()?.addEvent(`security.${name}`, safe);
}

export function sentryEnabled(): boolean {
  return Sentry.getClient() !== undefined;
}

/** Report an unexpected error. No-op (besides logging) when Sentry is not configured. */
export function captureException(err: unknown, context: Record<string, unknown> = {}) {
  if (sentryEnabled()) Sentry.captureException(err, { extra: scrub(context) });
}

/** Strip request data Sentry might attach (headers, cookies, bodies, user PII) before sending. */
export function sentryBeforeSend<E extends { request?: unknown; user?: unknown; extra?: Record<string, unknown> }>(event: E): E {
  delete event.request;
  delete event.user;
  if (event.extra) event.extra = scrub(event.extra);
  return event;
}
