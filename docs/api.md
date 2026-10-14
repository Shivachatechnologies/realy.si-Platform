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
* **Idempotency** _(Phase 1.1; table `idempotency_keys` exists)_ — mutating `POST`s will accept
  `Idempotency-Key`; replays within 24 h return the stored response; same key + different body →
  `409 idempotency_conflict`. Phase 1 relies on natural uniqueness constraints (e.g. one price per
  plan/interval/market) to make retries safe.
* **Request IDs** — every response carries `X-Request-Id` (accepted from the caller if well-formed,
  otherwise generated). It is written to logs, traces and audit rows.
* **Rate limits** — Redis fixed-window counters per IP on authentication endpoints (sign-up, sign-in,
  MFA verify: 10/min); exceeded → `429 rate_limited` + `Retry-After`. Per-principal API limits and
  `RateLimit-*` headers arrive with the public API (Phase 7).

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

## 3. Phase 1 endpoints (implemented)

All under `/api/v1` unless noted. "Auth" = session cookie; "MFA" = permission is MFA-gated (rbac.md §4).

| Method | Path | Auth / permission | Notes |
|---|---|---|---|
| GET | `/api/health` · `/api/health/ready` | public | liveness / readiness (DB + Redis) |
| POST | `/auth/sign-up` | public, 10/min/IP | `{email, password, name, locale?, timezone?, countryCode?}` → session cookie |
| POST | `/auth/sign-in` | public, 10/min/IP | → `{mfaRequired}`; with MFA the session is created MFA-pending |
| POST | `/auth/mfa/verify` | pending session | `{code}` (TOTP or recovery code) |
| POST | `/auth/mfa/totp/setup` · `/auth/mfa/totp/confirm` | session | enrollment; confirm returns 10 recovery codes once |
| POST | `/auth/sign-out` | session | revokes the session |
| GET · PATCH | `/me` | session | profile, locale (normalized to a shipped catalog), timezone, country |
| GET · POST | `/organizations` | session | creator becomes member + `ORGANIZATION_OWNER` |
| GET · POST | `/organizations/{orgId}/companies` | `companies.read` / `companies.manage` | cursor pagination |
| GET · POST | `/organizations/{orgId}/companies/{companyId}/workspaces` | `workspaces.read` / `.manage` | |
| GET | `/organizations/{orgId}/members` | `users.read` | members with role assignments |
| POST | `/organizations/{orgId}/invitations` | `users.manage` + `roles.assign` (MFA) + every permission in the role | returns id only; token goes to the invitee |
| POST | `/invitations/accept` | session (email must match) | |
| GET · POST | `/organizations/{orgId}/roles` | `roles.read` / `roles.manage` (MFA) | custom roles |
| POST · DELETE | `/organizations/{orgId}/role-assignments[/{id}]` | `roles.assign` (MFA), no escalation | last owner cannot be removed |
| GET · PUT | `/organizations/{orgId}/billing-profile` | `billing.read` / `billing.manage` (MFA) | explicit billing-country confirmation |
| POST | `/organizations/{orgId}/checkout/quote` | `billing.read` | regional price, coupon, tax config, payment methods |
| POST | `/organizations/{orgId}/checkout/session` | `billing.manage` (MFA) | `501 not_configured` until Stripe (Phase 1.1) |
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

Contracts not yet implemented: OAuth login (`/auth/oauth/{provider}/start|callback`, Phase 1.1),
Stripe webhooks (`/webhooks/stripe`, Phase 1.1).

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
