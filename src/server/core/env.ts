import { z } from "zod";

/** Empty strings (common in .env templates) count as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  /** Optional for the web app in production (rate limits fall back to Postgres); required by the worker (queues). */
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REALY_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Deployment surface: "user" (company app), "admin" (platform admin console) or unset (both). See src/proxy.ts. */
  APP_SURFACE: z.enum(["user", "admin"]).optional().or(z.literal("").transform(() => undefined)),
  /** First-run access: the email that becomes SUPER_ADMIN when it registers while no SUPER_ADMIN exists. */
  REALY_BOOTSTRAP_ADMIN_EMAIL: optional,
  /** On the user surface: the admin console's base URL (e.g. https://admin.realy.si); /admin redirects there. */
  ADMIN_URL: optional,
  /** On the admin surface: the company app's base URL, for the "Open the app" link. */
  USER_APP_URL: optional,
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
  // Integrations OS: OAuth apps for provider connections (all optional; Google/Microsoft reuse the login OAuth apps above).
  // Redirect URI to register with each provider: {APP_URL}/api/v1/integrations/oauth/{provider}/callback
  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,
  HUBSPOT_CLIENT_ID: optional,
  HUBSPOT_CLIENT_SECRET: optional,
  SALESFORCE_CLIENT_ID: optional,
  SALESFORCE_CLIENT_SECRET: optional,
  SALESFORCE_LOGIN_URL: z.string().url().default("https://login.salesforce.com"),
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  FACEBOOK_APP_ID: optional,
  FACEBOOK_APP_SECRET: optional,
  QUICKBOOKS_CLIENT_ID: optional,
  QUICKBOOKS_CLIENT_SECRET: optional,
  QUICKBOOKS_ENVIRONMENT: z.enum(["production", "sandbox"]).default("production"),
  XERO_CLIENT_ID: optional,
  XERO_CLIENT_SECRET: optional,
  // AI task execution (Claude API). Without a key, AI tasks report "not configured" and are never simulated.
  ANTHROPIC_API_KEY: optional,
  AGENT_MODEL: z.string().regex(/^[a-z0-9.-]{3,64}$/).default("claude-opus-5-5"),
  /** Daily AI token allowance per company (input + output, UTC day). 0 disables the limit. */
  AI_DAILY_TOKEN_LIMIT: z.coerce.number().int().min(0).default(2_000_000),
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
  // Per-IP rate limits are only as good as this number: too high trusts a client-supplied
  // X-Forwarded-For (Next.js passes it through when there is no proxy), 0 puts every client in one
  // bucket. Production must state its proxy topology rather than inherit the development default.
  if (parsed.data.NODE_ENV === "production" && !process.env.TRUSTED_PROXY_HOPS?.trim()) {
    throw new Error("TRUSTED_PROXY_HOPS must be set explicitly in production (number of proxies that append to X-Forwarded-For)");
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached env after mutating process.env. */
export function resetEnvCache() {
  cached = undefined;
}
