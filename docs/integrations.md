# Realy — Realy Connect (Integration Platform)

> Status: **Architecture frozen; implementation Phase 5.** Login OAuth (Phase 1) is separate from Realy Connect.

## 1. Architecture

```
Agent ─▶ Tool Gateway ─▶ Permission/Policy Engine ─▶ Realy Connect ─▶ Provider Adapter ─▶ External Provider
                                                       │
                                     connections · credentials (encrypted) · token refresh ·
                                     rate limits · webhooks · health · revocation
```
**Agents never receive provider credentials.** Adapters receive a short-lived, minimally-scoped
access token for the duration of one tool call, inside the worker process; tokens are never logged,
returned through the API, or placed in model context.

## 2. Provider adapter contract

```ts
interface ProviderAdapter {
  id: ProviderId;                         // "github", "stripe", "google", ...
  auth: OAuth2Config | ApiKeyConfig | AppInstallConfig;
  scopes: Record<Capability, string[]>;   // least-privilege scope sets per capability
  refresh?(conn): Promise<TokenSet>;
  revoke?(conn): Promise<void>;
  health(conn): Promise<HealthStatus>;     // periodic; drives "Connected / Degraded / Reauth required / Not connected"
  webhooks?: { verify(req): boolean; normalize(req): DomainEvent[] };
  rateLimit: { requests: number; perMs: number; scope: 'connection' | 'app' };
  operations: Record<string, ProviderOperation>;  // used by tools
}
```

## 3. Data model (Phase 5)
* `integrations` — provider catalog (id, category, auth type, available regions, plan entitlement).
* `oauth_connections` — `organization_id`, `company_id`, `provider`, `account_label`,
  `granted_scopes[]`, `status` (CONNECTED / DEGRADED / REAUTH_REQUIRED / REVOKED), `connected_by`,
  `last_health_at`.
* `credentials` — `connection_id`, `kind` (access_token, refresh_token, api_key, app_private_key),
  `ciphertext` (AES-256-GCM / KMS envelope), `key_version`, `expires_at`. No API returns these.
* `webhook_endpoints`, `webhook_deliveries` — signature-verified, idempotent by provider event id,
  normalized to domain events.

## 4. Flows
* **Connect**: founder clicks connect → server builds auth URL (PKCE, state bound to session + company)
  → callback exchanges code server-side → stores encrypted tokens → health check → `integration.connected` event.
* **Refresh**: proactive refresh 5 min before expiry under a per-connection Redis lock.
* **Disconnect / revoke**: provider revoke call + local credential deletion + `integration.disconnected`.
* **Health**: scheduled checks; failing connections move to DEGRADED/REAUTH_REQUIRED and dependent
  tools report "not connected" rather than failing silently.

## 5. Initial adapters (Phase 5 order)
GitHub (App installation), Vercel, Stripe (Connect / restricted keys), Google Workspace (Gmail,
Calendar, Drive), Microsoft 365, Slack, HubSpot, Cloudflare, AWS (IAM role assumption — no long-lived
keys), Meta, LinkedIn, X, Shopify, Twilio. The adapter contract supports 100+ providers; adding one
is a new adapter module + catalog row.

## 6. UI rule
Until an adapter exists and a connection is healthy, the Integrations page shows the provider as
**Not connected** (or "Coming in Phase 5" for adapters not yet built). No simulated connections.

## 7. Who manages what (current rule)

**Realy's own provider keys are entered once, in the Control Center → Platform keys; customers never handle a key.**
The user app has no API or credential controls: no key, token, secret, SMTP or bucket fields, no connection settings,
no Realy API keys and no webhook management. Accounts that belong to the customer are connected by signing in to them
("Connect with X") or, as a fallback, set up by the Realy team in the admin app.

| Kind | Providers | Customer sees (user app) | Managed in admin |
|---|---|---|---|
| **Platform-managed** (Realy's account) | AI: openai, gemini, openrouter, openai_compatible · Research: tavily, exa, serpapi, apollo, hunter, pdl · Creative: stability, replicate, runway · Voice: elevenlabs, deepgram · Video: jamendo, luma, kling, shotstack, creatomate · Telephony: twilio_voice, sip_trunk, vapi, retell · Email: sendgrid (+ transactional Resend / Postmark / SMTP) · Messaging: twilio · Storage: s3, cloudflare | Read-only **Available** / **Not available yet** | Platform keys (one key per credential field, e.g. `OPENAI_API_KEY`, `TWILIO_VOICE_AUTH_TOKEN`, `S3_SECRET_ACCESS_KEY`; write-only, live **Test** reusing the connection test) · on/off per provider |
| **Customer's own account, Realy's platform app** | Payments: stripe (Stripe Connect, Standard accounts), razorpay (Razorpay Partner OAuth) · Messaging: whatsapp (Meta Embedded Signup) · Email marketing: mailchimp (Mailchimp OAuth2) | **Connect with X** / **Disconnect**, the status, and **Set up by Realy team** when the admin configured it — no fields | Platform app credentials in Platform keys · per organization: status, **Set up / Rotate / Remove** the org's own credentials (Organization → Integrations), on/off per provider |
| **Customer OAuth** (the customer's OWN account, Realy's OAuth app) | google, microsoft, slack, hubspot, salesforce, social (linkedin, x, facebook, instagram, youtube, tiktok, threads, pinterest), ads (meta_ads, google_ads, linkedin_ads, tiktok_ads), google_search_console, google_drive, quickbooks, xero · added in B33: calendly, zendesk (asks for the subdomain first), intercom, shopify (asks for the shop first; the signed callback is verified), notion, webflow, clickup | **Connect with X** / **Disconnect** and the status — nothing else | OAuth client id / secret in Platform keys · on/off per provider · view status and disconnect per organization (Integrations & API, filter by organization) |
| **Not connectable yet** (customer's own account, no OAuth flow implemented) | pipedrive (OAuth tokens must use the account's `api_domain`; adapter not converted), wordpress, plaid, wise, revolut_business, zapier, make, n8n, custom_api, webhook | "Not available"; an existing connection keeps working and shows its status (read-only) | on/off per provider · view status and disconnect |

Code: `PLATFORM_MANAGED_PROVIDERS` / `customerConnectMode()` in `packages/backend/src/server/modules/integrations/catalog.ts`,
runtime in `integrations/platform-managed.ts`, user-app gate in `integrations/customer-access.ts`.

### Customer's own accounts (Stripe, Razorpay, WhatsApp, Mailchimp)

Money from a customer's payment links goes to the customer's **own** Stripe / Razorpay account, WhatsApp messages go
out from the customer's **own** WhatsApp Business number and Mailchimp campaigns use the customer's **own** audiences.
Realy's own Stripe account (`STRIPE_SECRET_KEY`, `/api/v1/webhooks/stripe`) stays the billing account for Realy's
subscriptions only; that path is unchanged. Code: `OWN_ACCOUNT_PROVIDERS` in `integrations/catalog.ts`, OAuth
definitions in `integrations/providers.ts`, routing and admin setup in `integrations/own-accounts.ts`, platform
webhooks in `integrations/own-account-webhooks.ts`, admin side in `admin/org-integrations.ts`.

| Provider | Connect with X (customer signs in / approves) | Stored on the connection | Platform webhook (routed by) |
|---|---|---|---|
| Stripe | Stripe Connect OAuth (`read_write`, Standard accounts): `connect.stripe.com/oauth/authorize` → `/oauth/token` (HTTP Basic with the platform secret key) | encrypted access + refresh token; config `stripeAccountId`, `livemode`, `authMode=connect` | `POST /api/v1/webhooks/stripe-connect` (`STRIPE_CONNECT_WEBHOOK_SECRET`), event `account`; `account.application.deauthorized` disconnects |
| Razorpay | Razorpay Partner OAuth: `auth.razorpay.com/authorize` → `/token` (`mode` from `RAZORPAY_OAUTH_MODE`), refreshed with the refresh token | encrypted access + refresh token (90 days); config `razorpayAccountId`, `authMode=oauth` | `POST /api/v1/webhooks/razorpay` (`RAZORPAY_WEBHOOK_SECRET`, X-Razorpay-Signature), `account_id`; `account.app.authorization_revoked` disconnects |
| WhatsApp | Meta Embedded Signup: Facebook Login for Business with `config_id` (`WHATSAPP_CONFIG_ID`) → code exchange → `debug_token` granular scopes name the shared WABA → its phone numbers; Realy's app is subscribed to the WABA (`subscribed_apps`) and the number registered for the Cloud API (random PIN kept encrypted) | encrypted business token (+ PIN); config `businessAccountId`, `phoneNumberId`, `accounts`, `authMode=embedded_signup` | `GET/POST /api/v1/webhooks/whatsapp` (`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`), each change's `metadata.phone_number_id`; a body is split per number so one company never sees another's messages |
| Mailchimp | Mailchimp OAuth2: `login.mailchimp.com/oauth2/authorize` → `/token` → `/metadata` (data center `dc`, account name) | encrypted access token (does not expire); config `serverPrefix`, `authMode=oauth`, audiences | — (scheduled syncs / health checks) |

- **Runtime**: these providers are no longer platform-managed, so `getConnection` returns the company's own row and
  every existing call — payment links and invoices (`services/payments.ts`), WhatsApp send / templates
  (`services/messaging.ts`, `services/whatsapp.ts`), Mailchimp audiences and campaigns (marketing) — uses the
  organization's own account. Scheduled syncs (`stripe.payments`), health checks, request logs and provider-webhook
  callbacks run for them again (the data is the customer's own).
- **Routing**: the account ids live in the connection's non-secret `config` (no schema change; JSON-path lookups,
  limited to active connections of that provider). A WhatsApp `phone_number_id` can belong to one active connection
  only (connecting a number another company uses is refused with `integrations_whatsapp_number_taken`); a Stripe or
  Razorpay account connected by several companies of the same customer delivers to each of them. Events for unknown
  accounts are acknowledged and dropped. Routed events are stored (deduplicated) as provider events; payment events
  schedule an immediate `stripe.payments` sync. Inbound WhatsApp messages also reach briefing replies
  (`briefing/inbound.ts → handleRoutedWhatsAppMessages`) when the company set up briefing channels.
- **Disconnect** revokes at the provider: Stripe `oauth/deauthorize` (platform key + account id), Razorpay `/revoke`,
  Meta `DELETE /me/permissions`. Keys set up by the Realy team are not revoked at the provider (they belong to the
  customer); the stored copy is deleted.
- **Realy-team setup (fallback)**: Admin → Organization → **Integrations** lists every company's four accounts (status,
  account, set up by customer or Realy team, last verified). Admins with `platform.controls.manage` or
  `platform.security.manage` (both MFA-gated: a fresh MFA verification is required) can **Set up / Rotate** — a Stripe
  restricted key, Razorpay key id + secret, WhatsApp permanent (system-user) token + phone number id (+ optional own
  Meta app secret), Mailchimp API key — and **Remove**. Values are validated against the catalog, verified with the
  provider's connection test (nothing is stored if it fails), encrypted, never returned and never logged; the audit
  log records `platform.integration_credentials_set` / `_rotated` / `_removed` with the reason and field names only.
  The connection carries `config.setupBy = "realy_team"`; the user app shows **Set up by Realy team** and the customer
  may still Disconnect (or replace it with their own Connect login).
- **Realy AI**: the `guide_account_connection` tool (integrations engineer, AI CTO, the Integrations page guide)
  reports which own accounts are connected, explains the steps in plain words, returns the page
  (`/integrations/<provider>`) and the Connect button target, and says the Realy team can set the account up instead.
  It has no input for credentials, and the tool gateway refuses any tool call whose input contains something that
  looks like a key or token (`core/secret-detect.ts`) before validation — nothing is executed, filed or stored, and the
  assistant tells the person to use Connect.
- **Existing data**: company rows of these providers stored before the platform-managed change (customer-entered keys)
  are read again — they are the customer's own accounts. Platform-key values saved for them earlier
  (`STRIPE_API_KEY`, `WHATSAPP_API_KEY`, `MAILCHIMP_API_KEY`, `RAZORPAY_*` field keys) stay in `platform_secrets` but
  are no longer on the allow-list, so they are never overlaid or used. Nothing was deleted.

### Runtime

- `getConnection(org, company, provider)` returns, for a platform-managed provider, a **platform connection** built
  from the platform keys (`platformConnection()`), scoped to that organization and company. Every existing service
  (AI text, research, contacts, images, video, render, music, TTS/STT, call center, messaging, email, storage, payment
  links) therefore uses Realy's key without code changes, and keeps its metering: `providerFetch` checks the plan's
  `api.cost.month` cap and meters `api.cost_cents`; services write `integration_usage` rows (mirrored into the cost
  ledger by the costs sync job); the call center meters `voice.minutes`. Missing keys → `null` → the honest
  "not available / awaiting platform configuration" state. Nothing is faked.
- Platform connections have no database row: request-log and health writes are skipped, provider-webhook callbacks
  are not registered for them (call status reaches the call center through its own webhooks), and scheduled syncs /
  health checks never run for platform-managed providers (Realy's own account data must never be copied into a tenant).
- Telephony runs on Realy's Twilio Voice account (`twilio_voice`). Numbers belong to the platform account, so caller
  ids, imports and webhook changes are limited to the numbers recorded for the company (`companyTwilioNumbers`).
- `WHATSAPP_APP_SECRET` is now the secret of Realy's Meta app for WhatsApp Embedded Signup (platform webhook
  signature); a Meta app secret a company stored on its own connection or briefing channel is still honoured.

### Customer-facing API

Routes that accepted or created credentials, settings, API keys or webhooks answer **403** with
`reason: integrations_admin_managed` (or `integrations_platform_managed` for platform-managed providers):
`…/integrations/:provider/{credentials,settings,account,test,sync}`, `PATCH …/integrations/:provider`,
`DELETE …/integrations/:provider` (allowed only for OAuth providers), `…/integration-hooks/**`,
`…/integration-webhooks/**`, `…/integration-webhook-deliveries/:id/redeliver`, `…/enterprise/api-keys/**`, SIP
credentials on `PATCH …/voice/settings`, `metaAppSecret` on `PUT …/briefing/channels`. Connecting a provider the admin
switched off answers 403 `integrations_disabled`.

### Existing data

Nothing was deleted or migrated. Company connection rows and stored credentials of platform-managed providers stay in
`integration_connections` but are no longer read (the admin list marks them "kept, unused"); Realy API keys, inbound
hooks and outbound webhook subscriptions keep working. No schema change was needed.
