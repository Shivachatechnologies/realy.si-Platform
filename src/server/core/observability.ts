import * as Sentry from "@sentry/node";
import type { Configuration } from "@vercel/otel";
import { env } from "./env";
import { logger } from "./logger";
import { sentryBeforeSend } from "./telemetry";

export interface ObservabilityStatus {
  sentry: boolean;
  otel: boolean;
}

export function observabilityStatus(): ObservabilityStatus {
  const e = env();
  return { sentry: !!e.SENTRY_DSN, otel: !!e.OTEL_EXPORTER_OTLP_ENDPOINT };
}

type SpanProcessor = Exclude<NonNullable<Configuration["spanProcessors"]>[number], "auto">;

/** URL-valued span attributes. Next.js puts the raw request URL (with query) on its own server spans. */
const URL_ATTRIBUTES = ["http.target", "http.url", "url.full"];

/**
 * Removes query strings from URL attributes before export: the OAuth callback carries `code` and `state`
 * in its query, and any other query may carry personal data. Next.js sets these attributes when the
 * span starts, so rewriting them in onStart covers its spans.
 */
export const stripUrlQueries: SpanProcessor = {
  onStart(span) {
    const attrs = (span as unknown as { attributes: Record<string, unknown> }).attributes;
    for (const key of URL_ATTRIBUTES) {
      const v = attrs[key];
      if (typeof v === "string" && v.includes("?")) span.setAttribute(key, v.slice(0, v.indexOf("?")));
    }
    if (attrs["url.query"] !== undefined) span.setAttribute("url.query", "[redacted]");
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

let initialized = false;

/**
 * Initialize error tracking and tracing for a process (web or worker). Each backend is enabled only
 * when configured; otherwise it is reported as NOT CONFIGURED and the telemetry API stays a no-op.
 */
export async function initObservability(serviceName: string): Promise<ObservabilityStatus> {
  const status = observabilityStatus();
  if (initialized) return status;
  initialized = true;
  const e = env();
  if (e.SENTRY_DSN) {
    Sentry.init({
      dsn: e.SENTRY_DSN,
      environment: e.SENTRY_ENVIRONMENT ?? e.NODE_ENV,
      serverName: serviceName,
      // SDK defaults collect cookies, headers, bodies, query strings and user info — all of which can carry
      // session tokens or one-time links. Collect none of it (beforeSend scrubs again as defense in depth).
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        stackFrameVariables: false,
      },
      // Errors only; tracing is OpenTelemetry's job (avoid two global tracer providers).
      tracesSampleRate: 0,
      enableOpenTelemetrySetup: false,
      beforeSend: (event) => sentryBeforeSend(event),
      beforeBreadcrumb: (b) => (b.category === "http" || b.category === "fetch" || b.category === "console" ? null : b),
    });
  }
  if (e.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName, spanProcessors: [stripUrlQueries, "auto"] });
  }
  logger.info({ otelServiceName: serviceName, sentry: status.sentry ? "configured" : "not_configured", otel: status.otel ? "configured" : "not_configured" }, "observability");
  return status;
}
