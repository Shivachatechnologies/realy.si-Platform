import pino from "pino";

/** Structured JSON logger. Secrets are redacted wherever they appear in logged objects. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: process.env.REALY_SERVICE ?? "web" },
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
