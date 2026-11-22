/**
 * Allow-list of platform keys an admin may set in Admin → Settings → Platform keys (docs/platform-keys.md).
 * Every entry is an env var name; anything not listed here can never be stored in `platform_secrets` or overlaid
 * onto process.env. Bootstrap variables the app needs before it can reach the database (or that change its security
 * topology) are deliberately absent and stay in the host environment — see BOOTSTRAP_ONLY_KEYS.
 *
 * Labels/help are short English technical text (env var names, provider console paths); the UI chrome is translated.
 */

import { PLATFORM_MANAGED_PROVIDERS, platformCredentialFields, providerInfo, type PlatformManagedProvider } from "@/server/modules/integrations/catalog";

export type PlatformKeyGroup = "ai" | "research" | "creative" | "voice" | "video" | "telephony" | "messaging" | "storage" | "email" | "payments" | "login" | "integrations" | "observability" | "platform";

/** Feature ids (translated under admin.keys.features.*) that stop working while the key is missing. */
export type PlatformFeature = "aiTasks" | "liveChatAi" | "email" | "billing" | "billingWebhooks" | "socialLogin" | "integrations" | "errorTracking" | "tracing" | "firstAdmin" | "platformProviders";

export interface PlatformKeyDef {
  key: string;
  group: PlatformKeyGroup;
  /** secret: masked, write-only. plain: the current value is shown. */
  kind: "secret" | "plain";
  label: string;
  help: string;
  /** Where to create / find the value. */
  docsUrl?: string;
  /** Path (after the user-app base URL) to register with the provider: OAuth redirect or webhook endpoint. */
  register?: { kind: "redirect" | "webhook"; paths: string[] };
  /** Format check run before saving (never contacts the provider). Return an error message or null. */
  validate: (value: string, all: (key: string) => string | undefined) => string | null;
  /** Features blocked while the key has no value (from the admin or the host env). */
  blocks?: PlatformFeature[];
  /** The key only matters in this configuration (e.g. SMTP_* only with EMAIL_PROVIDER=smtp); otherwise it blocks nothing. */
  appliesWhen?: (all: (key: string) => string | undefined) => boolean;
  /** Only takes effect after a restart / redeploy (initialised once per process). */
  restart?: boolean;
  /** A provider check is available (POST …/test). */
  testable?: boolean;
  /** Placeholder shown in the input (a format hint, never a real value). */
  placeholder?: string;
  /**
   * Platform-managed integration provider this key belongs to (modules/integrations/catalog.ts
   * PLATFORM_MANAGED_PROVIDERS): customers use the provider through the platform's account. The live test reuses the
   * integration's own connection test.
   */
  provider?: string;
  /** The provider is "Available" to customers only when every required key of it has a value. */
  required?: boolean;
}

/** Variables that must stay in the host environment (Vercel / worker). Never accepted by the admin API. */
export const BOOTSTRAP_ONLY_KEYS = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "REALY_ENCRYPTION_KEY",
  "REDIS_URL",
  "NODE_ENV",
  "TRUSTED_PROXY_HOPS",
  "REALY_DEV_RELAX_MFA",
  "FORCE_BUILD",
  // Deployment topology: same-origin (CSRF) checks, the admin redirect and every OAuth redirect URI derive from these,
  // and the proxies read them before any request could refresh platform keys.
  "APP_URL",
  "ADMIN_URL",
  "USER_APP_URL",
  "REALY_APP",
  "REALY_SERVICE",
  "WORKER_ROLES",
] as const;

const MAX = 4096;
const ok = null;

const nonEmpty = (v: string) => (v.length === 0 ? "Value is required" : v.length > MAX ? "Value is too long" : ok);
const pattern =
  (re: RegExp, message: string) =>
  (v: string): string | null =>
    nonEmpty(v) ?? (re.test(v) ? ok : message);
const oneOf =
  (values: string[]) =>
  (v: string): string | null =>
    values.includes(v) ? ok : `Must be one of: ${values.join(", ")}`;
const url = (v: string): string | null => {
  const e = nonEmpty(v);
  if (e) return e;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? ok : "Must be an http(s) URL";
  } catch {
    return "Must be a valid URL";
  }
};
/** OAuth client id / secret: printable, no whitespace. Provider-side checks happen at connect time. */
const token = pattern(/^[\x21-\x7e]{6,512}$/, "Must be 6–512 printable characters without spaces");
const email = pattern(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, "Must be an email address");

const OAUTH_LOGIN = (p: string) => `/api/v1/auth/oauth/${p}/callback`;
const OAUTH_INT = (p: string) => `/api/v1/integrations/oauth/${p}/callback`;

function oauthPair(
  group: PlatformKeyGroup,
  idKey: string,
  secretKey: string,
  name: string,
  docsUrl: string,
  redirectPaths: string[],
  blocks: PlatformFeature[],
): PlatformKeyDef[] {
  return [
    { key: idKey, group, kind: "plain", label: `${name} client ID`, help: `OAuth app client ID from the ${name} developer console.`, docsUrl, register: { kind: "redirect", paths: redirectPaths }, validate: token, blocks },
    { key: secretKey, group, kind: "secret", label: `${name} client secret`, help: `OAuth app client secret from the ${name} developer console. Rotate it there, then paste the new one here.`, docsUrl, validate: token, blocks },
  ];
}

/** Platform-keys group of each platform-managed provider (Vapi and Retell are "messaging" in the integrations catalog). */
const PROVIDER_GROUP: Record<PlatformManagedProvider, PlatformKeyGroup> = {
  openai: "ai",
  gemini: "ai",
  openrouter: "ai",
  openai_compatible: "ai",
  tavily: "research",
  exa: "research",
  serpapi: "research",
  apollo: "research",
  hunter: "research",
  pdl: "research",
  stability: "creative",
  replicate: "creative",
  runway: "creative",
  elevenlabs: "voice",
  deepgram: "voice",
  jamendo: "video",
  luma: "video",
  kling: "video",
  shotstack: "video",
  creatomate: "video",
  twilio_voice: "telephony",
  sip_trunk: "telephony",
  vapi: "telephony",
  retell: "telephony",
  sendgrid: "email",
  mailchimp: "email",
  twilio: "messaging",
  whatsapp: "messaging",
  s3: "storage",
  cloudflare: "storage",
  stripe: "payments",
  razorpay: "payments",
};

const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/\bApi\b/g, "API").replace(/\bUrl\b/g, "URL").replace(/\bId\b/g, "ID").replace(/\bSip\b/g, "SIP");

/**
 * One platform key per credential / setting field of every platform-managed provider, derived from the integrations
 * catalog so the formats stay identical to what the connection test expects (OPENAI_API_KEY, TWILIO_VOICE_AUTH_TOKEN…).
 */
function providerKeys(): PlatformKeyDef[] {
  const out: PlatformKeyDef[] = [];
  for (const provider of PLATFORM_MANAGED_PROVIDERS) {
    const info = providerInfo(provider);
    if (!info) continue;
    for (const f of platformCredentialFields(info)) {
      const re = f.pattern ? new RegExp(f.pattern) : null;
      const label = `${info.name} ${words(f.labelKey ?? f.key)}`;
      out.push({
        key: f.envKey,
        group: PROVIDER_GROUP[provider],
        kind: f.secret ? "secret" : "plain",
        label,
        help: f.required
          ? `Required for ${info.name}. Used for every company's ${info.name} calls through the platform account; usage counts against each company's plan limits and cost ledger.`
          : `Optional ${info.name} setting. Applies platform-wide.`,
        docsUrl: info.docsUrl,
        validate: re ? pattern(re, `Does not match the expected ${label} format`) : nonEmpty,
        blocks: f.required ? ["platformProviders"] : undefined,
        testable: f.key === "apiKey",
        placeholder: f.placeholder,
        provider,
        required: f.required,
      });
    }
  }
  return out;
}

export const PLATFORM_KEYS: PlatformKeyDef[] = [
  // ───── AI ─────
  {
    key: "ANTHROPIC_API_KEY",
    group: "ai",
    kind: "secret",
    label: "Anthropic API key",
    help: "Claude API key used for AI tasks and website chat. Create one in the Anthropic Console under API keys.",
    docsUrl: "https://console.anthropic.com/settings/keys",
    validate: pattern(/^sk-ant-[A-Za-z0-9_-]{20,}$/, "Anthropic keys start with sk-ant-"),
    blocks: ["aiTasks", "liveChatAi"],
    testable: true,
    placeholder: "sk-ant-…",
  },
  {
    key: "AGENT_MODEL",
    group: "ai",
    kind: "plain",
    label: "Default AI model",
    help: "Claude model id used when a profile does not choose one (default claude-opus-5-5).",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
    validate: pattern(/^[a-z0-9.-]{3,64}$/, "Lowercase model id, e.g. claude-opus-5-5"),
    placeholder: "claude-opus-5-5",
  },
  {
    key: "AGENT_ALLOWED_MODELS",
    group: "ai",
    kind: "plain",
    label: "Extra allowed models",
    help: "Comma-separated model ids admins may pick in addition to the built-in list.",
    validate: pattern(/^[a-z0-9.-]{3,64}(\s*,\s*[a-z0-9.-]{3,64})*$/, "Comma-separated lowercase model ids"),
    placeholder: "claude-sonnet-4-5, claude-haiku-4-5",
  },
  {
    key: "AI_DAILY_TOKEN_LIMIT",
    group: "ai",
    kind: "plain",
    label: "Daily AI token limit per company",
    help: "Input + output tokens per company per UTC day. 0 disables the limit (default 2,000,000).",
    validate: pattern(/^\d{1,12}$/, "Whole number (0 = no limit)"),
    placeholder: "2000000",
  },
  // ───── Email ─────
  {
    key: "EMAIL_PROVIDER",
    group: "email",
    kind: "plain",
    label: "Email provider",
    help: "resend, postmark or smtp (e.g. Google Workspace). Transactional email (password resets, invitations, notifications) is sent through it.",
    validate: oneOf(["resend", "postmark", "smtp"]),
    blocks: ["email"],
    placeholder: "resend",
  },
  {
    key: "EMAIL_API_KEY",
    group: "email",
    kind: "secret",
    label: "Email API key",
    help: "Resend API key (re_…) or Postmark server token (a UUID), matching the provider above. Not used with smtp.",
    docsUrl: "https://resend.com/api-keys",
    appliesWhen: (all) => all("EMAIL_PROVIDER") !== "smtp",
    validate: (v, all) => {
      const e = nonEmpty(v);
      if (e) return e;
      const provider = all("EMAIL_PROVIDER");
      if (provider === "smtp") return "EMAIL_PROVIDER is smtp: set SMTP_PASSWORD instead of an API key";
      const resend = /^re_[A-Za-z0-9_]{10,}$/.test(v);
      const postmark = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      if (provider === "resend" && !resend) return "Resend keys start with re_";
      if (provider === "postmark" && !postmark) return "Postmark server tokens are UUIDs";
      return resend || postmark ? ok : "Expected a Resend key (re_…) or a Postmark server token (UUID)";
    },
    blocks: ["email"],
    testable: true,
    placeholder: "re_… / xxxxxxxx-xxxx-…",
  },
  {
    key: "EMAIL_FROM",
    group: "email",
    kind: "plain",
    label: "From address",
    help: 'Sender, e.g. "Realy <no-reply@realy.si>". The domain must be verified with the provider. With Gmail SMTP it must be SMTP_USER or a verified "Send mail as" alias.',
    validate: (v) => nonEmpty(v) ?? (/^([^<>\r\n]{1,100}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(v) ? ok : 'Use "Name <email>" or an email address'),
    blocks: ["email"],
    placeholder: "Realy <no-reply@realy.si>",
  },
  // SMTP (EMAIL_PROVIDER=smtp), e.g. Google Workspace: docs/deployment.md "Email through Google Workspace".
  {
    key: "SMTP_HOST",
    group: "email",
    kind: "plain",
    label: "SMTP host",
    help: "smtp.gmail.com (Gmail / Google Workspace mailbox) or smtp-relay.gmail.com (Workspace SMTP relay). Only used when EMAIL_PROVIDER is smtp.",
    docsUrl: "https://support.google.com/a/answer/176600",
    validate: pattern(/^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*$/, "Host name, e.g. smtp.gmail.com"),
    blocks: ["email"],
    appliesWhen: (all) => all("EMAIL_PROVIDER") === "smtp",
    testable: true,
    placeholder: "smtp.gmail.com",
  },
  { key: "SMTP_PORT", group: "email", kind: "plain", label: "SMTP port", help: "587 (STARTTLS, default) or 465 (implicit TLS). 25 is often blocked by hosting providers.", validate: pattern(/^([1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/, "Port number 1–65535"), placeholder: "587" },
  { key: "SMTP_SECURE", group: "email", kind: "plain", label: "SMTP implicit TLS", help: "true for port 465 (implicit TLS), false for STARTTLS. Leave empty to derive it from the port.", validate: oneOf(["true", "false"]), placeholder: "false" },
  { key: "SMTP_USER", group: "email", kind: "plain", label: "SMTP username", help: "The full mailbox address (e.g. no-reply@yourdomain.com). Leave empty only for an SMTP relay that authenticates by IP address.", validate: pattern(/^[^\s]{1,254}$/, "Username without spaces (usually the mailbox address)"), placeholder: "no-reply@yourdomain.com" },
  {
    key: "SMTP_PASSWORD",
    group: "email",
    kind: "secret",
    label: "SMTP password",
    help: "For Google: an App Password of SMTP_USER (Google Account → Security → 2-Step Verification → App passwords), not the account password.",
    docsUrl: "https://support.google.com/accounts/answer/185833",
    validate: pattern(/^[\x20-\x7e]{1,512}$/, "1–512 printable characters"),
    appliesWhen: (all) => all("EMAIL_PROVIDER") === "smtp" && !!all("SMTP_USER"),
    blocks: ["email"],
    testable: true,
    placeholder: "xxxx xxxx xxxx xxxx",
  },
  // ───── Payments ─────
  {
    key: "STRIPE_SECRET_KEY",
    group: "payments",
    kind: "secret",
    label: "Stripe secret key",
    help: "Secret (sk_…) or restricted (rk_…) key from the Stripe Dashboard → Developers → API keys. Test keys work in test mode.",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    validate: pattern(/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/, "Stripe keys start with sk_live_, sk_test_, rk_live_ or rk_test_"),
    blocks: ["billing"],
    testable: true,
    placeholder: "sk_live_…",
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    group: "payments",
    kind: "secret",
    label: "Stripe webhook signing secret",
    help: "Signing secret of the webhook endpoint below (Stripe Dashboard → Developers → Webhooks).",
    docsUrl: "https://dashboard.stripe.com/webhooks",
    register: { kind: "webhook", paths: ["/api/v1/webhooks/stripe"] },
    validate: pattern(/^whsec_[A-Za-z0-9+/=]{10,}$/, "Webhook secrets start with whsec_"),
    blocks: ["billingWebhooks"],
    placeholder: "whsec_…",
  },
  {
    key: "STRIPE_AUTOMATIC_TAX",
    group: "payments",
    kind: "plain",
    label: "Stripe automatic tax",
    help: "true to let Stripe Tax calculate tax at checkout (requires Stripe Tax to be enabled on the account).",
    validate: oneOf(["true", "false"]),
    placeholder: "false",
  },
  // ───── Login OAuth ─────
  ...oauthPair("login", "OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET", "Google", "https://console.cloud.google.com/apis/credentials", [OAUTH_LOGIN("google"), OAUTH_INT("google"), OAUTH_INT("youtube"), OAUTH_INT("google_search_console"), OAUTH_INT("google_ads")], ["socialLogin", "integrations"]),
  ...oauthPair("login", "OAUTH_GITHUB_CLIENT_ID", "OAUTH_GITHUB_CLIENT_SECRET", "GitHub", "https://github.com/settings/developers", [OAUTH_LOGIN("github")], ["socialLogin"]),
  ...oauthPair("login", "OAUTH_MICROSOFT_CLIENT_ID", "OAUTH_MICROSOFT_CLIENT_SECRET", "Microsoft", "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade", [OAUTH_LOGIN("microsoft"), OAUTH_INT("microsoft")], ["socialLogin", "integrations"]),
  {
    key: "OAUTH_MICROSOFT_TENANT",
    group: "login",
    kind: "plain",
    label: "Microsoft tenant",
    help: "common (any account), organizations, consumers, or a tenant id/domain.",
    validate: pattern(/^[A-Za-z0-9.-]{1,64}$/, "Tenant id, domain or common"),
    placeholder: "common",
  },
  // ───── Integration OAuth apps ─────
  ...oauthPair("integrations", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "Slack", "https://api.slack.com/apps", [OAUTH_INT("slack")], ["integrations"]),
  ...oauthPair("integrations", "HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", "HubSpot", "https://developers.hubspot.com/", [OAUTH_INT("hubspot")], ["integrations"]),
  ...oauthPair("integrations", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET", "Salesforce", "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm", [OAUTH_INT("salesforce")], ["integrations"]),
  { key: "SALESFORCE_LOGIN_URL", group: "integrations", kind: "plain", label: "Salesforce login URL", help: "https://login.salesforce.com, or https://test.salesforce.com for sandboxes.", validate: url, placeholder: "https://login.salesforce.com" },
  ...oauthPair("integrations", "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LinkedIn", "https://www.linkedin.com/developers/apps", [OAUTH_INT("linkedin"), OAUTH_INT("linkedin_ads")], ["integrations"]),
  ...oauthPair("integrations", "X_CLIENT_ID", "X_CLIENT_SECRET", "X", "https://developer.x.com/en/portal/dashboard", [OAUTH_INT("x")], ["integrations"]),
  ...oauthPair("integrations", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "Meta (Facebook)", "https://developers.facebook.com/apps", [OAUTH_INT("facebook"), OAUTH_INT("instagram"), OAUTH_INT("meta_ads")], ["integrations"]),
  ...oauthPair("integrations", "THREADS_APP_ID", "THREADS_APP_SECRET", "Threads", "https://developers.facebook.com/apps", [OAUTH_INT("threads")], ["integrations"]),
  ...oauthPair("integrations", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TikTok", "https://developers.tiktok.com/apps", [OAUTH_INT("tiktok")], ["integrations"]),
  ...oauthPair("integrations", "TIKTOK_ADS_APP_ID", "TIKTOK_ADS_APP_SECRET", "TikTok Ads", "https://business-api.tiktok.com/portal/apps", [OAUTH_INT("tiktok_ads")], ["integrations"]),
  ...oauthPair("integrations", "PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET", "Pinterest", "https://developers.pinterest.com/apps/", [OAUTH_INT("pinterest")], ["integrations"]),
  ...oauthPair("integrations", "MAILCHIMP_CLIENT_ID", "MAILCHIMP_CLIENT_SECRET", "Mailchimp", "https://admin.mailchimp.com/account/oauth2/", [OAUTH_INT("mailchimp")], ["integrations"]),
  ...oauthPair("integrations", "QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QuickBooks", "https://developer.intuit.com/app/developer/dashboard", [OAUTH_INT("quickbooks")], ["integrations"]),
  { key: "QUICKBOOKS_ENVIRONMENT", group: "integrations", kind: "plain", label: "QuickBooks environment", help: "production or sandbox.", validate: oneOf(["production", "sandbox"]), placeholder: "production" },
  ...oauthPair("integrations", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "Xero", "https://developer.xero.com/app/manage", [OAUTH_INT("xero")], ["integrations"]),
  {
    key: "GOOGLE_ADS_DEVELOPER_TOKEN",
    group: "integrations",
    kind: "secret",
    label: "Google Ads developer token",
    help: "Developer token of the platform's Google Ads manager account (API Center). Companies may override it on their connection.",
    docsUrl: "https://ads.google.com/aw/apicenter",
    validate: pattern(/^[A-Za-z0-9_-]{10,64}$/, "10–64 letters, digits, - or _"),
  },
  { key: "GOOGLE_ADS_API_VERSION", group: "integrations", kind: "plain", label: "Google Ads API version", help: "e.g. v21.", validate: pattern(/^v\d{2}$/, "Like v21"), placeholder: "v21" },
  // ───── Observability ─────
  {
    key: "SENTRY_DSN",
    group: "observability",
    kind: "secret",
    label: "Sentry DSN",
    help: "Project DSN from Sentry → Project settings → Client keys. Applied on the next deploy / restart.",
    docsUrl: "https://docs.sentry.io/concepts/key-terms/dsn-explainer/",
    validate: pattern(/^https:\/\/[0-9a-f]{16,64}@[A-Za-z0-9.-]+(:\d+)?\/\d+$/, "Expected https://<key>@<host>/<project-id>"),
    blocks: ["errorTracking"],
    restart: true,
    testable: true,
    placeholder: "https://…@o0.ingest.sentry.io/0",
  },
  { key: "SENTRY_ENVIRONMENT", group: "observability", kind: "plain", label: "Sentry environment", help: "Environment tag on reported errors (defaults to NODE_ENV).", validate: pattern(/^[A-Za-z0-9_.-]{1,64}$/, "Letters, digits, . _ -"), restart: true, placeholder: "production" },
  { key: "OTEL_EXPORTER_OTLP_ENDPOINT", group: "observability", kind: "plain", label: "OpenTelemetry OTLP endpoint", help: "Trace exporter endpoint. Applied on the next deploy / restart.", validate: url, blocks: ["tracing"], restart: true, placeholder: "https://otlp.example.com" },
  { key: "LOG_LEVEL", group: "observability", kind: "plain", label: "Log level", help: "fatal, error, warn, info, debug or trace (default info).", validate: oneOf(["fatal", "error", "warn", "info", "debug", "trace", "silent"]), placeholder: "info" },
  // ───── Platform ─────
  {
    key: "REALY_BOOTSTRAP_ADMIN_EMAIL",
    group: "platform",
    kind: "plain",
    label: "Bootstrap admin email",
    help: "While no super admin exists, the account registering with this email becomes one. Clear it once set up.",
    validate: email,
    blocks: ["firstAdmin"],
  },
  { key: "ENTITLEMENTS_ENFORCEMENT", group: "platform", kind: "plain", label: "Plan limits enforcement", help: "enforce (default) or off to disable plan limit checks platform-wide.", validate: oneOf(["enforce", "off"]), placeholder: "enforce" },
  // ───── Platform-managed providers (AI, research, creative, voice, video, telephony) ─────
  ...providerKeys(),
];

export const PLATFORM_KEY_GROUPS: PlatformKeyGroup[] = ["ai", "research", "creative", "voice", "video", "telephony", "messaging", "storage", "email", "payments", "login", "integrations", "observability", "platform"];

const BY_KEY = new Map(PLATFORM_KEYS.map((d) => [d.key, d]));

export const platformKeyDef = (key: string): PlatformKeyDef | undefined => BY_KEY.get(key);

/** True only for allow-listed keys (and never for a bootstrap key). */
export const isPlatformKey = (key: string): boolean => BY_KEY.has(key) && !(BOOTSTRAP_ONLY_KEYS as readonly string[]).includes(key);
