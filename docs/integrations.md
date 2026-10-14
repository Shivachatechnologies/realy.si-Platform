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
