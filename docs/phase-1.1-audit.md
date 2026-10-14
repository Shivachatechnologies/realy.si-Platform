# Phase 1.1 — Pre-change Audit

> Date: 2026-10-14. Baseline: commit `e2f2e96` on `claude/determined-lovelace-exapwp`.
> Method: code inspection plus targeted verification (grep, database queries, running the app).
> Documentation was **not** taken as evidence; every row below was checked against code.

Legend: **IMPLEMENTED** · **PARTIAL** · **NOT IMPLEMENTED** · **BROKEN** · **DOCUMENTATION ONLY**

## Tooling, build, delivery

| Item | Status | Evidence / notes |
|---|---|---|
| Next.js 16 App Router, TS strict, Tailwind 4 | IMPLEMENTED | `package.json`, `tsconfig.json` |
| Cache Components / PPR | IMPLEMENTED | `next.config.ts` (`cacheComponents: true`). Blocks nonce CSP (see CSP). |
| Prisma 7 + `@prisma/adapter-pg`, single migration | IMPLEMENTED | `prisma/migrations/20261014131511_init` (includes exclusion constraint, triggers) |
| Seed (reference data + dev catalog) | IMPLEMENTED | `prisma/seed.ts`, `src/server/modules/seed.ts` |
| Unit/integration tests (Vitest, real Postgres) | IMPLEMENTED | 69 tests, 6 files |
| E2E (Playwright) | IMPLEMENTED | 9 tests, `tests/e2e/founder-journey.spec.ts` |
| GitHub Actions CI | PARTIAL | `.github/workflows/ci.yml` exists; never executed; no migration-drift check; no Docker job |
| Dockerfile | PARTIAL | written, never built; `pnpm build` inside requires env vars at build time that are not provided |
| docker-compose (Postgres+pgvector, Redis) | DOCUMENTATION ONLY | file exists, never run |

## Identity & sessions

| Item | Status | Evidence / notes |
|---|---|---|
| Email/password sign-up/sign-in, argon2id | IMPLEMENTED | `modules/auth/service.ts`, `password.ts` |
| Opaque DB sessions (hashed token, absolute + idle expiry, revocation) | IMPLEMENTED | `modules/auth/session.ts` |
| TOTP MFA, replay protection, recovery codes | IMPLEMENTED | `totp.ts`, `verifyMfa` |
| MFA brute force protection | PARTIAL | only 10/min **per IP**; no per-session/per-account attempt cap — a distributed attacker can keep guessing 6-digit codes on one pending session |
| Password reset | NOT IMPLEMENTED | no routes, tables or UI |
| Email verification | NOT IMPLEMENTED | `users.email_verified_at` exists but is never written |
| OAuth login (Google/GitHub/Microsoft) | NOT IMPLEMENTED | only the `oauth_accounts` table; docs mark it Phase 1.1 |
| Enterprise SSO | DOCUMENTATION ONLY | |
| Sign-out | IMPLEMENTED | |

## Tenancy, RBAC, isolation

| Item | Status | Evidence / notes |
|---|---|---|
| Organizations, memberships, companies, workspaces, projects | IMPLEMENTED | services + tests |
| Invitations — creation, single-use, addressee-bound acceptance (service level) | IMPLEMENTED | `organizations/service.ts`, tests |
| Invitations — end-to-end flow | **BROKEN** | the raw token is never delivered: no email is sent, the API deliberately does not return it, and there is no accept page. No user can join an organization through the product today. |
| Invitation re-validation at acceptance | NOT IMPLEMENTED | inviter's authority is checked at creation only; a revoked inviter's pending invitations still grant roles |
| Invitation list / revoke / resend | NOT IMPLEMENTED | |
| RBAC engine (scopes, no-escalation, MFA gating, agent restrictions) | IMPLEMENTED | `rbac/service.ts`, 20+ tests |
| Service-layer tenant isolation (404 on foreign ids) | IMPLEMENTED | `rbac-tenancy.test.ts` |
| Database-level tenant controls | NOT IMPLEMENTED | no RLS; no composite FKs preventing a workspace/project referencing another organization's company |
| PostgreSQL RLS | NOT IMPLEMENTED | 0 policies. App connects as role `realy`, which is a **superuser** locally → RLS would be bypassed anyway |

## API layer

| Item | Status | Evidence / notes |
|---|---|---|
| `route()` wrapper: request ids, error envelope, auth, CSRF origin check | IMPLEMENTED | `core/http.ts`, `api.test.ts` |
| Request body size limit | NOT IMPLEMENTED | `req.json()` with no cap |
| Rate limiting | PARTIAL / **BROKEN as a control** | Redis fixed window on sign-up, sign-in, MFA only. The key uses the **left-most `X-Forwarded-For` value, which any client can spoof**, so the limit is bypassable. Fails open always. No per-account limit. No `RateLimit-*` headers (docs already say so). |
| Idempotency keys | NOT IMPLEMENTED | `idempotency_keys` table exists, unused |
| Public pricing / reference APIs | IMPLEMENTED | no rate limit |

## Billing & pricing

| Item | Status | Evidence / notes |
|---|---|---|
| Catalog, regional resolution, immutable versioning (DB-enforced) | IMPLEMENTED | `pricing/service.ts`, triggers, tests |
| Coupons/promotions in quotes | IMPLEMENTED | |
| Billing profile with explicit country confirmation | IMPLEMENTED | |
| Stripe checkout | NOT IMPLEMENTED | `createCheckoutSession` always throws `not_configured` |
| Stripe webhooks / subscription lifecycle | NOT IMPLEMENTED | `activateSubscription` exists for SYSTEM use only |
| Customer portal | NOT IMPLEMENTED | |
| Usage metering writers | NOT IMPLEMENTED | table only |

## Globalization

| Item | Status | Evidence / notes |
|---|---|---|
| 5 locales, RTL, Intl formatting, locale negotiation | IMPLEMENTED | catalogs + tests + E2E |
| Countries/regions/currencies/tax configs | IMPLEMENTED | seed + admin |
| Independent country dimensions | IMPLEMENTED | E2E founder-in-India/company-in-UAE |

## Admin console

| Item | Status | Evidence / notes |
|---|---|---|
| Pricing console, countries, flags, audit log | IMPLEMENTED | E2E admin price change |
| Integration/configuration status view | NOT IMPLEMENTED | admins cannot see which external services are configured |

## Security headers / CSP

| Item | Status | Evidence / notes |
|---|---|---|
| Static headers (nosniff, referrer, frame denial, permissions, HSTS in prod) | IMPLEMENTED | `next.config.ts`, verified with curl |
| Nonce-based `script-src` CSP | NOT IMPLEMENTED | and **incompatible** with the current PPR setup (Next.js docs: static shell scripts cannot receive a per-request nonce) |

## Events, audit, observability

| Item | Status | Evidence / notes |
|---|---|---|
| Same-transaction audit + outbox, relay worker | IMPLEMENTED | tests + live run |
| Expired data cleanup (sessions, idempotency keys, tokens) | NOT IMPLEMENTED | |
| Structured logging with redaction | IMPLEMENTED | `core/logger.ts` |
| OpenTelemetry | DOCUMENTATION ONLY | no SDK, no spans |
| Sentry | DOCUMENTATION ONLY | |
| Health/readiness endpoints | IMPLEMENTED | |

## Email

| Item | Status | Evidence / notes |
|---|---|---|
| Email provider abstraction | NOT IMPLEMENTED | |
| Any outbound email | NOT IMPLEMENTED | |

## Docs accuracy

Phase 1 docs were corrected before this audit (endpoint table, rate limiting, RBAC caching). Remaining
inaccuracies found: `security.md` states rate limiting is per-IP without noting the spoofable header;
`architecture.md` lists OpenTelemetry/Sentry in the technology table without stating they are not wired.

## Phase 1.1 work derived from this audit

1. Fix: trusted client-IP resolution; per-account and per-session limits; MFA attempt cap.
2. Fix: invitation flow end-to-end (email provider, accept page, re-validation, list/revoke/resend).
3. Add: email provider abstraction, email verification, password reset.
4. Add: Stripe checkout, webhooks (verified, idempotent), lifecycle sync, portal.
5. Add: OAuth (Google, GitHub, Microsoft) with state + PKCE and safe account linking.
6. Add: idempotency keys on mutating APIs.
7. Add: nonce CSP (requires leaving PPR), body size limits.
8. Add: database-level tenant consistency constraints; decide on RLS with evidence.
9. Add: OpenTelemetry + Sentry with safe degradation.
10. Validate CI steps and Docker for real.
