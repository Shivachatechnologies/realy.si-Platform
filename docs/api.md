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
* **Idempotency** — mutating `POST`s accept `Idempotency-Key`; replays within 24 h return the stored
  response; same key + different body → `409 idempotency_conflict`.
* **Request IDs** — every response carries `X-Request-Id` (accepted from the caller if well-formed,
  otherwise generated). It is written to logs, traces and audit rows.
* **Rate limits** — token bucket per principal and per IP (Redis). Headers: `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset`; exceeded → `429 rate_limited` + `Retry-After`.

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
`idempotency_conflict` 409, `rate_limited` 429, `internal_error` 500.

## 3. Phase 1 endpoints

### Auth
| Method | Path | Notes |
|---|---|---|
| ✅ POST | `/api/v1/auth/sign-up` | `{email, password, name, locale?, timezone?, countryCode?}` → session cookie |
| ✅ POST | `/api/v1/auth/sign-in` | `{email, password}` → session, or `{mfaRequired: true}` (session is created in MFA-pending state) |
| ✅ POST | `/api/v1/auth/mfa/verify` | `{code}` (TOTP or recovery code) → upgrades session |
| ✅ POST | `/api/v1/auth/mfa/totp/setup` | → `{otpauthUrl, secret}` (unconfirmed factor) |
| ✅ POST | `/api/v1/auth/mfa/totp/confirm` | `{code}` → `{recoveryCodes: string[]}` (shown once) |
| ✅ POST | `/api/v1/auth/sign-out` | revokes session |
| ✅ GET | `/api/v1/me` | user, memberships, effective locale/direction |
| GET | `/api/v1/auth/oauth/{provider}/start` · `/callback` | provider abstraction; returns `not_configured` when provider credentials absent |

### Tenancy
| ✅ GET/POST | `/api/v1/organizations` | list mine / create (creator gets ORGANIZATION_OWNER) |
|---|---|---|
| ✅ GET/POST | `/api/v1/organizations/{orgId}/companies` | `companies.read` / `companies.manage` |
| ✅ GET/POST | `/api/v1/organizations/{orgId}/companies/{companyId}/workspaces` | |
| ✅ GET/POST | `/api/v1/organizations/{orgId}/members` · `/invitations` | `users.read` / `users.manage` |
| ✅ GET/POST | `/api/v1/organizations/{orgId}/roles` | custom roles; `roles.manage` |
| ✅ POST | `/api/v1/organizations/{orgId}/role-assignments` | grant role at scope; cannot grant permissions the granter lacks |

### Globalization & pricing (public read)
| ✅ GET | `/api/v1/catalog/pricing?country=IN&interval=MONTH` | resolved regional prices for all public plans |
|---|---|---|
| ✅ GET | `/api/v1/reference/countries` · `/regions` · `/currencies` · `/locales` | reference data |

### Checkout
| ✅ POST | `/api/v1/organizations/{orgId}/checkout/quote` | `{planKey, interval, billingCountryCode, couponCode?}` → resolved price version, currency, tax config, payment methods, trial, total (pre-tax) |
|---|---|---|
| POST | `/api/v1/organizations/{orgId}/checkout/session` | creates Stripe Checkout session from the quote; `not_configured` without Stripe keys |

### Admin (platform principals only)
| ✅ GET/POST/PATCH | `/api/v1/admin/plans` | `pricing.read` / `pricing.manage` @ PLATFORM |
|---|---|---|
| ✅ GET/POST | `/api/v1/admin/plans/{planId}/prices` | create regional price (market scope checked: REGION/COUNTRY admins only for their market) |
| ✅ POST | `/api/v1/admin/prices/{priceId}/versions` | schedule a new version `{amountMinor, effectiveFrom, reason}`; requires MFA-verified session |
| ✅ GET/PATCH | `/api/v1/admin/countries/{code}` · `/regions/{code}` | `globalization.manage` scoped |
| ✅ GET/POST/PATCH | `/api/v1/admin/feature-flags` (+ `/rules`) | `flags.manage` |
| ✅ GET | `/api/v1/admin/audit-logs?cursor=` | `audit.read` |
| ✅ GET | `/api/health` · `/api/health/ready` | liveness / readiness (DB + Redis) |

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
