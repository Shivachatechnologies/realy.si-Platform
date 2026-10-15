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

---

# Post-change status (2026-10-15)

Re-assessed after the Phase 1.1 work, against code and verification runs (not docs). The rows above
are kept unchanged as the baseline. Additional legend: **IMPLEMENTED (not live-verified)** = works
in code and automated tests against test doubles, but has never been exercised against the real
external provider because no credentials exist in this environment.

| Item (baseline status) | Now | Evidence |
|---|---|---|
| Cache Components / PPR (IMPLEMENTED) | **Disabled on purpose** | incompatible with per-request CSP nonces; pages render per request |
| GitHub Actions CI (PARTIAL) | IMPLEMENTED, **replicated locally**, not yet run on GitHub | every workflow step run in a clean clone without `.env` (2026-10-15): drift check, typecheck, lint, 119 tests, build, 19 E2E — all green. Workflow now adds a migration-drift check and a container smoke test |
| Dockerfile (PARTIAL) | IMPLEMENTED (fixed) | image builds without build-time env; **bug found and fixed**: runtime `pnpm start` failed as the non-root user (corepack needs a writable home + network). Web, worker and migrate entrypoints verified in containers, `/api/health/ready` = ready, uid 1001 |
| docker-compose (DOCUMENTATION ONLY) | unchanged | not run (services were started directly) |
| MFA brute force (PARTIAL) | IMPLEMENTED | per-IP + per-session limits; 5th wrong code revokes the pending session; audited |
| Password reset (NOT IMPLEMENTED) | IMPLEMENTED (email delivery not live-verified) | `auth/recovery.ts`, `email-invitations.test.ts` |
| Email verification (NOT IMPLEMENTED) | IMPLEMENTED (email delivery not live-verified) | same |
| OAuth Google/GitHub/Microsoft (NOT IMPLEMENTED) | IMPLEMENTED (not live-verified) | `auth/oauth.ts`, `oauth.test.ts` (state, PKCE, no auto-link, unverified-email refusal, nOAuth); "OAuth provider not configured." verified in E2E for 4 locales |
| Invitations end-to-end (**BROKEN**) | IMPLEMENTED (email delivery not live-verified) | token delivered by email as a fragment link; accept page; list/revoke/resend; NOT_CONFIGURED reported truthfully |
| Invitation re-validation (NOT IMPLEMENTED) | IMPLEMENTED | inviter's authority re-checked at acceptance |
| Database-level tenant controls (NOT IMPLEMENTED) | IMPLEMENTED (composite FKs) | verified on an upgraded Phase-1 database: cross-tenant workspace insert rejected |
| PostgreSQL RLS (NOT IMPLEMENTED) | **NOT IMPLEMENTED — deliberately deferred** | would be bypassed by the current owner/superuser role; plan in `security.md` §10 |
| Request body size limit (NOT IMPLEMENTED) | IMPLEMENTED | 64 KiB default, 1 MiB webhook, `413` |
| Rate limiting (PARTIAL / BROKEN) | IMPLEMENTED | trusted-hop client IP, sliding window in Redis (atomic), per-account/session/principal buckets, `RateLimit-*` headers; concurrent burst admits exactly the limit; fail-closed (503) for auth buckets in production when Redis is down (tested) |
| Idempotency keys (NOT IMPLEMENTED) | IMPLEMENTED | principal+endpoint scope, replay, conflict 422, in-progress 409, failure release, expiry purge, concurrency test. Limitation: crash after claim → key blocked until expiry (24 h) |
| Public API rate limit (none) | IMPLEMENTED | `public:ip` 120/min |
| Stripe checkout / webhooks / portal (NOT IMPLEMENTED) | IMPLEMENTED (not live-verified) | `stripe-billing.ts`; webhook signature, stale-timestamp, duplicate (sequential and concurrent), out-of-order, cross-tenant tests; "Billing is not configured." verified in E2E |
| Usage metering writers (NOT IMPLEMENTED) | unchanged — Phase 2 | |
| Integration/configuration status view (NOT IMPLEMENTED) | IMPLEMENTED | Admin → System (booleans only) |
| Nonce `script-src` CSP (NOT IMPLEMENTED) | IMPLEMENTED | E2E fails on any CSP violation; header test checks every `<script>` carries the request nonce; `style-src 'unsafe-inline'` remains (documented) |
| Expired data cleanup (NOT IMPLEMENTED) | PARTIAL | idempotency keys + auth tokens purged by the worker every 10 min; expired sessions are not purged yet |
| OpenTelemetry (DOCUMENTATION ONLY) | IMPLEMENTED (opt-in) | exported to a local OTLP sink: **leak found and fixed** — Next.js spans carried the OAuth callback `code`/`state` in `http.target`; now stripped; re-verified clean |
| Sentry (DOCUMENTATION ONLY) | IMPLEMENTED (opt-in) | real SDK to a local envelope sink: no user/IP/breadcrumbs/secrets; console breadcrumbs now dropped too |
| Email provider abstraction / outbound email (NOT IMPLEMENTED) | IMPLEMENTED (not live-verified) | Resend + Postmark over HTTPS; `email_messages` delivery log without bodies or tokens |
| Docs accuracy | corrected | `api.md`, `security.md` (+§9 observability, §10 isolation/RLS), `billing.md`, `database.md`, `roadmap.md`, `architecture.md`, README |

### Approval round (2026-10-15, second pass)

| Item | Before | Now | Evidence |
|---|---|---|---|
| Double billing (two payable checkouts / two live subscriptions) | **BROKEN** (open review finding) | IMPLEMENTED (not live-verified) | DB checkout lock + one-live-subscription partial indexes; Stripe-side checks; 11 double-billing tests incl. concurrency and negative controls (`billing-stripe.test.ts`) |
| Forgot-password account enumeration (timing) | **BROKEN** (open review finding) | IMPLEMENTED | request path enqueues only; worker does lookup/token/email; identical status/body/headers, timing test with a slow provider + negative control; live worker run |
| Email verification as hijack vector | **BROKEN** (found in review) | IMPLEMENTED | verification bound to the signed-in account; test |
| Tests reaching a non-test database | PARTIAL (name check only; URL echoed with credentials; E2E unguarded) | IMPLEMENTED | `tests/db-guard.ts` for unit/integration/E2E; live refusals |
| Migration atomicity | **BROKEN** (`prisma migrate deploy` left half-applied schema on failure) | IMPLEMENTED | `BEGIN`/`COMMIT` in both Phase 1.1 migrations; upgrade A/B/C cases via `prisma migrate deploy` |

Remaining gaps are listed in `phase-1.1-final-report.md` §4.
