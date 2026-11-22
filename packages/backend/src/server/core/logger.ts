import pino from "pino";

/**
 * A log sink receives every record at warn level or above (stream E: the optional `app_log_entries` store,
 * modules/admin/logs.ts). Sinks run synchronously inside the log call, so they must only buffer: never await, never
 * log through `logger` themselves (re-entrant records are dropped). Records keep pino's redaction only after
 * serialization, so a sink scrubs on its own.
 */
export type LogSink = (level: number, record: Record<string, unknown>, message: string) => void;

const sinkStore = globalThis as unknown as { realyLogSinks?: Set<LogSink>; realyLogSinkDepth?: number };
const sinks = () => (sinkStore.realyLogSinks ??= new Set());

/** Add a warn-and-above sink. Returns an unsubscribe function. */
export function addLogSink(sink: LogSink): () => void {
  sinks().add(sink);
  return () => void sinks().delete(sink);
}

const WARN = 40;

function forward(args: unknown[], level: number) {
  if (level < WARN || !sinkStore.realyLogSinks?.size || (sinkStore.realyLogSinkDepth ?? 0) > 0) return;
  const [first, second] = args;
  const record = first && typeof first === "object" && !(first instanceof Error) ? (first as Record<string, unknown>) : first instanceof Error ? { err: first } : {};
  const message = typeof first === "string" ? first : typeof second === "string" ? second : first instanceof Error ? first.message : "";
  sinkStore.realyLogSinkDepth = (sinkStore.realyLogSinkDepth ?? 0) + 1;
  try {
    for (const s of sinks()) s(level, record, message);
  } catch {
    // never break logging
  } finally {
    sinkStore.realyLogSinkDepth = (sinkStore.realyLogSinkDepth ?? 1) - 1;
  }
}

/** Structured JSON logger. Secrets are redacted wherever they appear in logged objects. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.REALY_SERVICE ?? "web" },
  hooks: {
    logMethod(args, method, level) {
      forward(args, level);
      return method.apply(this, args as Parameters<typeof method>);
    },
  },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "cookie",
      "*.cookie",
      "apiKey",
      "*.apiKey",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[redacted]",
  },
});
