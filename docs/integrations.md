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

**Every API key belongs to Realy and is entered once, in the Control Center → Platform keys.** The user app has no
API or credential controls: no key, token, secret, SMTP or bucket fields, no connection settings, no Realy API keys
and no webhook management.

| Kind | Providers | Customer sees (user app) | Managed in admin |
|---|---|---|---|
| **Platform-managed** (Realy's account) | AI: openai, gemini, openrouter, openai_compatible · Research: tavily, exa, serpapi, apollo, hunter, pdl · Creative: stability, replicate, runway · Voice: elevenlabs, deepgram · Video: jamendo, luma, kling, shotstack, creatomate · Telephony: twilio_voice, sip_trunk, vapi, retell · Email: sendgrid, mailchimp (+ transactional Resend / Postmark / SMTP) · Messaging: twilio, whatsapp · Storage: s3, cloudflare · Payments: stripe, razorpay | Read-only **Available** / **Not available yet** | Platform keys (one key per credential field, e.g. `OPENAI_API_KEY`, `TWILIO_VOICE_AUTH_TOKEN`, `S3_SECRET_ACCESS_KEY`; write-only, live **Test** reusing the connection test) · on/off per provider |
| **Customer OAuth** (the customer's OWN account, Realy's OAuth app) | google, microsoft, slack, hubspot, salesforce, social (linkedin, x, facebook, instagram, youtube, tiktok, threads, pinterest), ads (meta_ads, google_ads, linkedin_ads, tiktok_ads), google_search_console, google_drive, quickbooks, xero | **Connect with X** / **Disconnect** and the status — nothing else | OAuth client id / secret in Platform keys · on/off per provider · view status and disconnect per organization (Integrations & API, filter by organization) |
| **Not connectable yet** (customer's own account, no OAuth flow implemented) | pipedrive, notion, clickup, calendly, shopify, wordpress, webflow, zendesk, intercom, plaid, wise, revolut_business, zapier, make, n8n, custom_api, webhook | "Not available"; an existing connection keeps working and shows its status (read-only) | on/off per provider · view status and disconnect |

Code: `PLATFORM_MANAGED_PROVIDERS` / `customerConnectMode()` in `packages/backend/src/server/modules/integrations/catalog.ts`,
runtime in `integrations/platform-managed.ts`, user-app gate in `integrations/customer-access.ts`.

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
- The Meta (WhatsApp) app secret is `WHATSAPP_APP_SECRET`; a secret a company stored earlier is still honoured.

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
