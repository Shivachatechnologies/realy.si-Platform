import * as Sentry from "@sentry/node";
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
      beforeBreadcrumb: (b) => (b.category === "http" || b.category === "fetch" ? null : b),
    });
  }
  if (e.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({ serviceName });
  }
  logger.info({ service: serviceName, sentry: status.sentry ? "configured" : "not_configured", otel: status.otel ? "configured" : "not_configured" }, "observability");
  return status;
}
