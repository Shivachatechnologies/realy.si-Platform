# Realy — API Contracts

> Status: **Conventions frozen.** Endpoints marked ✅ exist in Phase 1; others are contracts for later phases.

## 1. Surfaces

| Surface | Base | Auth | Consumers |
|---|---|---|---|
| Internal app API | `/api/v1/*` on the web app | session cookie (+ CSRF via same-site + origin check) | Realy web UI |
| Public API (Phase 7) | `https://api.realy.si/v1/*` | API key (`Authorization: Bearer rk_live_…`) or OAuth 2.0 access token | customers, partners |
| Webhooks in | `/api/v1/webhooks/<provider>` | provider signature (Stripe, GitHub, …) | providers |
| Webhooks out (Phase 7) | customer endpoints | HMAC-SHA256 signature header `Realy-Signature: t=…,v1=…` | customers |

The internal and public APIs share handlers and contracts; the public API is the internal one with
API-key/OAuth authentication and stricter rate limits.

## 2. Conventions

* **Versioning** — URL major version (`/v1`). Additive changes are non-breaking. Breaking changes ship
  as `/v2` with ≥ 12 months overlap. Events are versioned independently (`type` + `version`).
* **Resources** — plural nouns, kebab-case: `/v1/organizations/{orgId}/companies`.
  Tenant is always explicit in the path for org-owned resources; the server re-verifies membership.
* **Validation** — every body/query is parsed by a Zod schema; invalid input → `400 validation_error`.
* **Money** — `{ "amountMinor": "9900", "currency": "USD" }`; `amountMinor` is a **string** to
  preserve 64-bit integers in JSON.
* **Time** — RFC 3339 UTC strings.
* **Pagination** — cursor: `?limit=50&cursor=<opaque>` → `{ data: [...], nextCursor: string | null }`.
  `limit` max 200. No offset pagination on large collections.
* **Idempotency** _(implemented, Phase 1.1)_ — creating `POST`s (organizations, companies,
  workspaces, roles, invitations, prices, price versions, promotions, checkout sessions, …) accept an
  optional `Idempotency-Key` header (8–255 chars of `[A-Za-z0-9_-:.]`). Keys are scoped by
  **principal + endpoint template**, so a key can never replay another user's or another action's
  response. A key is claimed atomically (unique index) before the handler runs:
  * same key + same method/path/body → the stored `2xx` response is replayed, with
    `Idempotent-Replayed: true`, for 24 h;
  * same key + a different request → `422 idempotency_conflict`, nothing is executed;
  * a duplicate arriving while the first is still running → `409 idempotency_in_progress`;
  * a request that fails (non-2xx or exception) releases its key so the client can retry.
  Expired keys are purged by the worker. Known limitation: if a process dies after claiming a key but
  before completing or releasing it, the key answers `409 idempotency_in_progress` until it expires
  (24 h) — chosen over a lease that could re-execute a mutation that had already committed.
* **Request IDs** — every response carries `X-Request-Id` (accepted from the caller if well-formed,
  otherwise generated). It is written to logs, traces and audit rows.
* **Rate limits** _(implemented, Phase 1.1)_ — sliding-window counters in Redis (atomic Lua script),
  shared by every app instance. Buckets are keyed by client IP (resolved from `X-Forwarded-For`
  using `TRUSTED_PROXY_HOPS`, never the client-controlled left-most entry), by account (hashed
  email), by session or by principal — see `src/server/core/limits.ts`: sign-up, sign-in (per IP and
  per account), MFA verify (per IP and per session), password reset, email verification, OAuth,
  invitations (create/accept), admin, billing, tenant writes and public reads. Every limited response
  carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a denial is
  `429 rate_limited` + `Retry-After`. If Redis is unreachable in production, authentication buckets
  fail **closed** (`503 service_unavailable`) and the rest fail open; outside production a
  per-process in-memory fallback keeps limits working on a single instance (dev/test only).
* **Body size** — request bodies above 64 KiB (1 MiB for the Stripe webhook) → `413 payload_too_large`
  before parsing.

### Error envelope
```json
{
  "error": {
    "code": "forbidden",
    "message": "Missing permission pricing.manage at COUNTRY:US",
    "requestId": "req_01J…",
    "details": { "permission": "pricing.manage" }
  }
}
```
Codes: `validation_error` 400, `unauthenticated` 401, `mfa_required` 401, `forbidden` 403,
`not_found` 404 (also returned for cross-tenant ids — never leak existence), `conflict` 409,
`idempotency_in_progress` 409, `payload_too_large` 413, `idempotency_conflict` 422,
`rate_limited` 429, `not_configured` 501, `service_unavailable` 503, `internal_error` 500.

## 3. Phase 1 / 1.1 endpoints (implemented)

All under `/api/v1` unless noted. "Auth" = session cookie; "MFA" = permission is MFA-gated (rbac.md §4).

| Method | Path | Auth / permission | Notes |
|---|---|---|---|
| GET | `/api/health` · `/api/health/ready` | public | liveness / readiness (DB + Redis) |
| POST | `/auth/sign-up` | public, 10/h/IP | `{email, password, name, locale?, timezone?, countryCode?}` → session cookie + `emailVerification: SENT\|FAILED\|NOT_CONFIGURED` |
| POST | `/auth/sign-in` | public, 20/min/IP + 10/15 min/account | → `{mfaRequired}`; with MFA the session is created MFA-pending |
| POST | `/auth/mfa/verify` | pending session, 10/15 min/session | `{code}` (TOTP or recovery code); 5 wrong codes revoke the pending session |
| POST | `/auth/password/forgot` | public, 5/15 min/IP + 3/h/address | `{email}` → `200 {emailDelivery: configured\|not_configured}`, identical (status, body, headers, timing) whether or not the account exists; the email is sent by the worker; `503` (same for every address) if the job queue is unreachable |
| POST | `/auth/password/reset` | public (token) | `{token, password}`; single-use, 30 min; revokes every session |
| POST | `/auth/email/verify` · `/auth/email/resend` | session of the account the link was issued for (+ token) · session | 24 h single-use verification links |
| GET | `/auth/oauth/{google\|github\|microsoft}/start` | public (or session for `mode=link`) | state + PKCE S256 in an encrypted HttpOnly cookie; redirects back with `?oauthError=not_configured` when the provider has no credentials; `mode=link` requires a verified email (`oauthError=verify_email_first`) |
| GET | `/auth/oauth/{provider}/callback` | state cookie | no auto-linking by email; accounts only from provider-verified emails; Microsoft email never trusted |
| POST | `/auth/mfa/totp/setup` · `/auth/mfa/totp/confirm` | session | enrollment; confirm returns 10 recovery codes once |
| POST | `/auth/sign-out` | session | revokes the session |
| GET · PATCH | `/me` | session | profile, locale (normalized to a shipped catalog), timezone, country |
| GET · POST | `/organizations` | session | creator becomes member + `ORGANIZATION_OWNER` |
| GET · POST | `/organizations/{orgId}/companies` | `companies.read` / `companies.manage` | cursor pagination |
| GET · POST | `/organizations/{orgId}/companies/{companyId}/workspaces` | `workspaces.read` / `.manage` | |
| GET | `/organizations/{orgId}/members` | `users.read` | members with role assignments |
| GET · POST | `/organizations/{orgId}/invitations` | `users.read` / `users.manage` + `roles.assign` (MFA) + every permission in the role | POST → `{invitationId, delivery: SENT\|FAILED\|NOT_CONFIGURED}`; the token is only emailed (fragment link) |
| DELETE | `/organizations/{orgId}/invitations/{id}` | `users.manage` | revoke |
| POST | `/organizations/{orgId}/invitations/{id}/resend` | `users.manage` | rotates the token, re-sends |
| POST | `/invitations/accept` | session (email must match) | inviter's authority is re-checked at acceptance |
| GET · POST | `/organizations/{orgId}/roles` | `roles.read` / `roles.manage` (MFA) | custom roles |
| POST · DELETE | `/organizations/{orgId}/role-assignments[/{id}]` | `roles.assign` (MFA), no escalation | last owner cannot be removed |
| GET · PUT | `/organizations/{orgId}/billing-profile` | `billing.read` / `billing.manage` (MFA) | explicit billing-country confirmation |
| POST | `/organizations/{orgId}/checkout/quote` | `billing.read` | regional price, coupon, tax config, payment methods |
| POST | `/organizations/{orgId}/checkout/session` | `billing.manage` (MFA) | Stripe Checkout URL derived from the server-side quote; repeating the same plan returns the same open session; `409` with `details.reason` = `checkout_in_progress` \| `payment_processing` \| `already_subscribed` (see billing.md §6, double-billing protection); `501 not_configured` ("Billing is not configured.") without Stripe credentials |
| POST | `/organizations/{orgId}/billing/portal` | `billing.manage` (MFA) | Stripe customer portal URL |
| POST | `/webhooks/stripe` | Stripe signature | verified with the webhook secret (300 s tolerance); idempotent by event id |
| GET | `/organizations/{orgId}/audit-logs` | `audit.read` | |
| GET | `/catalog/pricing?country=IN&interval=MONTH` | public | resolved regional prices |
| GET | `/reference/{countries\|regions\|currencies\|locales}` | public | |
| GET · POST · PATCH | `/admin/plans[/{planId}]` | `pricing.read` (any market) / `pricing.manage` @ PLATFORM (MFA) | |
| POST | `/admin/plans/{planId}/prices` | `pricing.manage` @ the price's market chain (MFA) | REGION/COUNTRY admins only for their markets |
| POST | `/admin/prices/{priceId}/versions` | `pricing.manage` @ market (MFA) | schedule `{amountMinor, effectiveFrom?, reason}` |
| PATCH | `/admin/prices/{priceId}` | `pricing.manage` @ market (MFA) | activate / deactivate a market price |
| PUT | `/admin/plans/{planId}/entitlements` | `pricing.manage` @ PLATFORM (MFA) | |
| POST | `/admin/promotions` | `pricing.manage` @ each restricted market (MFA) | optional coupon code |
| PATCH | `/admin/countries/{code}` · `/admin/regions/{code}` | `globalization.manage` @ country/region chain (MFA) | |
| GET · PATCH | `/admin/feature-flags[/{flagId}]` | `flags.read` / `flags.manage` (MFA) | |
| POST · DELETE | `/admin/feature-flags/{flagId}/rules` · `/admin/feature-flag-rules/{ruleId}` | `flags.manage` (MFA) | |
| GET | `/admin/audit-logs?category=&cursor=` | `platform.audit.read` | |

All rows above are implemented. Stripe, email and OAuth require credentials (see `.env.example`);
without them the endpoints report "not configured" truthfully instead of simulating success.

## 4. Later-phase resource contracts (public API v1 shape)

`/companies`, `/people`, `/products`, `/customers`, `/objectives` (+ `/plans`, `/milestones`),
`/tasks`, `/approvals` (`POST /approvals/{id}/approve|reject`), `/workflows` (+ `/runs`),
`/agents` (+ `/runs`, `POST /agents/{id}/pause|resume|kill`), `/tools` (registry, read-only),
`/integrations` (`/connections`), `/events` (cursor stream + webhooks), `/analytics/metrics`.
All follow §2. Long operations return `202 Accepted` + an operation resource (`/operations/{id}`) and
stream status over SSE at `/api/v1/stream?topics=…`.

## 5. Real-time

Server-Sent Events at `/api/v1/stream` (per organization, permission-filtered) carrying execution
state transitions: `queued → planning → executing → waiting | approval_required → completed | failed`.
SSE is chosen over WebSockets for unidirectional status (HTTP-friendly, auto-reconnect via
`Last-Event-ID`). Fan-out is via Redis pub/sub from workers.
