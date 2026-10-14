import { z } from "zod";

/** Empty strings (common in .env templates) count as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REALY_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  REALY_DEV_RELAX_MFA: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /**
   * Number of trusted reverse proxies in front of the app. The client IP is the X-Forwarded-For entry
   * this many hops from the right; entries further left are client-controlled and ignored.
   * 0 = do not trust X-Forwarded-For at all.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  // Optional external services. Each feature reports "not configured" when its variables are absent.
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_AUTOMATIC_TAX: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  EMAIL_PROVIDER: z.enum(["resend", "postmark"]).optional().or(z.literal("").transform(() => undefined)),
  EMAIL_API_KEY: optional,
  EMAIL_FROM: optional,
  OAUTH_GOOGLE_CLIENT_ID: optional,
  OAUTH_GOOGLE_CLIENT_SECRET: optional,
  OAUTH_GITHUB_CLIENT_ID: optional,
  OAUTH_GITHUB_CLIENT_SECRET: optional,
  OAUTH_MICROSOFT_CLIENT_ID: optional,
  OAUTH_MICROSOFT_CLIENT_SECRET: optional,
  OAUTH_MICROSOFT_TENANT: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/).default("common"),
  SENTRY_DSN: optional,
  SENTRY_ENVIRONMENT: optional,
  OTEL_EXPORTER_OTLP_ENDPOINT: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws on first access if misconfigured. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.REALY_DEV_RELAX_MFA) {
    throw new Error("REALY_DEV_RELAX_MFA must not be enabled in production");
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached env after mutating process.env. */
export function resetEnvCache() {
  cached = undefined;
}
