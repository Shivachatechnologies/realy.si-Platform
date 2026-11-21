# Platform keys

Platform-level API keys and provider settings (Anthropic, Resend/Postmark, Stripe, OAuth apps, Sentry, …) can be
entered in the **Control Center → Settings → Platform keys** (`admin.realy.si/<locale>/keys`) instead of the hosting
environment (Vercel / worker env vars).

## What stays in the hosting environment

These are needed before the app can reach the database, or define its security topology, and are **never** accepted
by the admin API (`BOOTSTRAP_ONLY_KEYS` in `packages/backend/src/server/core/platform-secrets-catalog.ts`):

| Variable | Why |
|---|---|
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | the keys live in the database |
| `REALY_ENCRYPTION_KEY` | decrypts the stored keys |
| `REDIS_URL` | queues / rate limits start before any request |
| `NODE_ENV`, `TRUSTED_PROXY_HOPS`, `REALY_DEV_RELAX_MFA`, `FORCE_BUILD` | process / security posture |
| `APP_URL`, `ADMIN_URL`, `USER_APP_URL`, `REALY_APP`, `REALY_SERVICE`, `WORKER_ROLES` | same-origin (CSRF) checks, proxies and OAuth redirect URIs derive from them |

## What can be set in the admin

The allow-list in `platform-secrets-catalog.ts`, grouped on the page:

- **AI**: `ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_ALLOWED_MODELS`, `AI_DAILY_TOKEN_LIMIT`
- **Email**: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`
- **Payments**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_AUTOMATIC_TAX`
- **Sign-in OAuth**: `OAUTH_GOOGLE_*`, `OAUTH_GITHUB_*`, `OAUTH_MICROSOFT_*`, `OAUTH_MICROSOFT_TENANT`
- **Integration OAuth apps**: `SLACK_*`, `HUBSPOT_*`, `SALESFORCE_*` (+ `SALESFORCE_LOGIN_URL`), `LINKEDIN_*`, `X_*`,
  `FACEBOOK_APP_*`, `THREADS_APP_*`, `TIKTOK_CLIENT_*`, `TIKTOK_ADS_APP_*`, `PINTEREST_*`, `MAILCHIMP_*`,
  `QUICKBOOKS_*` (+ `QUICKBOOKS_ENVIRONMENT`), `XERO_*`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_API_VERSION`
- **Observability**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`
- **Platform**: `REALY_BOOTSTRAP_ADMIN_EMAIL`, `ENTITLEMENTS_ENFORCEMENT`

Each entry is either **secret** (masked, write-only; the UI shows only the last 4 characters) or **plain** (its value
is visible). The page shows the redirect / webhook URL to register with each provider, computed from `USER_APP_URL`
(or `APP_URL`), and which features stay blocked while a key is missing.

## Precedence

1. A value saved in the admin (table `platform_secrets`, AES-256-GCM with the `platform-secret` purpose) **wins**.
2. Otherwise the hosting env value is used.
3. **Clear** deletes the admin value and restores the original hosting value (snapshotted before the first override),
   or leaves the key missing if the host has none.

Values are validated per key before saving (`sk-ant-…`, `re_…` / Postmark UUID, `sk_live_`/`sk_test_`/`rk_…`,
`whsec_…`, URLs, enums). A stored value that would make the environment invalid is rejected at load time and the
previous values are kept.

## Refresh time

`packages/backend/src/server/core/platform-secrets.ts` overlays the stored keys onto `process.env` and resets the
`env()` cache. `ensurePlatformSecretsFresh()` (30 s TTL, single-flight, never throws) runs in both apps'
`instrumentation.ts` `register()`, at the start of every `route()` and `getSession()`, and in the worker at startup and
every 30 s. The instance that saves a change applies it immediately; every other instance within **~30 seconds**.
Clients built from a key (Anthropic, Stripe) rebuild when the key's fingerprint changes.

Keys marked **restart** (`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`) are read once at process
start: they apply on the next deploy / cold start. If the database is unreachable, the last loaded values (or the host
env) stay in effect.

## Rotation

1. Create the new key at the provider (keep the old one active).
2. Paste it in Platform keys → **Replace** → **Test** (side-effect-free check: Anthropic `GET /v1/models`, Resend
   `GET /domains`, Postmark `GET /server`, Stripe `GET /v1/balance`; Sentry/OAuth: format only) → **Save** with a
   reason.
3. Wait ~1 minute for every instance to pick it up, then revoke the old key at the provider.

For `STRIPE_WEBHOOK_SECRET`, roll the endpoint secret in Stripe and save the new `whsec_…` promptly; events signed
with the new secret fail verification until it is applied.

Rotating `REALY_ENCRYPTION_KEY` makes stored platform keys undecryptable (they are skipped and logged by name):
re-enter them after rotating.

## Security

- Permissions: `platform.controls.manage` or `platform.security.manage` (SUPER_ADMIN, SECURITY_ADMIN) to change or test;
  `platform.security.read` additionally to view status. Both manage permissions are MFA-gated (fresh MFA required).
- Secret values are never returned by any API, never sent to the browser, never logged and never written to the audit
  log. Audit actions: `platform.secret.set`, `platform.secret.cleared`, `platform.secret.tested` (key name, source and
  outcome only). Other super admins get an email naming the key and the actor.
- Set / clear / test routes are same-origin (CSRF) checked like every admin write and rate limited
  (`LIMITS.platformSecrets`: 20 per 15 minutes per admin).
