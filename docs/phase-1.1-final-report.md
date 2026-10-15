# Phase 1.1 — Production Hardening: Final Approval Report

> Branch `claude/determined-lovelace-exapwp` · baseline `e2f2e96` · report date 2026-10-15.
> Companion documents: `phase-1.1-audit.md` (baseline audit + post-change status),
> `staging-verification.md` (real-provider test plan).

## 0. Verdict

**Phase 1.1 is not complete.** The code is finished and verified locally, but two required gates
cannot be run from this environment:

1. **GitHub Actions has never run the workflow.** Every workflow step was replicated locally on a
   copy of the working tree with no `.env`, and all passed (§3).
2. **No integration has been tested against a real provider.** Stripe, email and OAuth are tested
   only against test doubles, and their "not configured" states are verified in the UI. The staging
   plan is ready (`staging-verification.md`).

Nothing has been committed or pushed since the review began; that is awaiting approval (§9).

| Verification level | Meaning | Status |
|---|---|---|
| **Locally verified** | Automated tests, a production build, Docker and live runs in this sandbox, against real PostgreSQL 16 and Redis 7 | ✅ all gates in §3 |
| **GitHub Actions verified** | The workflow ran green on GitHub for the pushed commit | ❌ not run (no push yet) |
| **Real-provider verified** | Stripe test mode, Resend or Postmark, and Google/GitHub/Microsoft OAuth exercised on staging (`staging-verification.md`) | ❌ not run (no staging credentials here) |

## 1. Fixes in this approval round, with test evidence

Test files are in `tests/integration` unless noted. "Negative control" means the fix was temporarily
reverted and the named test was confirmed to fail, then the fix was restored.

### 1.1 P0 — Double billing
**Problem.** The "already subscribed" check only saw subscriptions created by the webhook. Two checkout
sessions opened before that webhook arrived could both be paid.

**Fix** (`billing/stripe-billing.ts`, `billing/gateway.ts`, migration `20261015120000_checkout_sessions`;
details in `billing.md` §6):
1. **Database checkout lock.** A new `checkout_sessions` table has a partial unique index allowing one
   `OPEN` row per organization. A request reserves that row *before* calling Stripe, so concurrent
   requests race on the index.
2. **Same plan → same session.** A repeat request for the same plan returns the open session.
3. **Different plan → old session expired first.** The open session is expired at Stripe before a new
   one is created. If Stripe reports it as already paid, the request is refused.
4. **Stripe is checked first.** Under the lock, Stripe is asked whether the customer already has an
   unended subscription (paid, webhook not yet applied).
5. **Orphans are expired.** Any other open Stripe sessions for the customer are expired before a new
   one is created; this covers a crash between the Stripe call and the database write.
6. **Lost reservation → session discarded.** The session id is stored only if the request still holds
   its reservation. Otherwise the new session is expired, never returned.
7. **Bounded lifetime.** `expires_at` is 35 minutes, computed right at the Stripe call, and an
   idempotency key is used per reservation.
8. **One live subscription.** A partial unique index allows one live subscription per organization.
   The webhook never activates a second one: it acknowledges the event, writes a SECURITY audit entry
   and leaves cancel/refund to a human (runbook in `billing.md`).
9. **Webhooks.** `checkout.session.completed`/`expired` keep the checkout rows in step, including when
   events arrive out of order (via `checkoutId` in subscription metadata).
10. **The redirect changes nothing.** `?checkout=success` is display-only.

**Evidence** (`billing-stripe.test.ts`, 25 tests, 3 consecutive green runs):

| Test | Proves |
|---|---|
| concurrent checkout requests (8 parallel) | exactly one Stripe session; everyone else gets `409 checkout_in_progress` or the same URL. **Negative control:** without the index, the test fails |
| the database refuses a second OPEN checkout or a second live subscription | protection holds at the database level (`P2002`) |
| switching plan expires the open session first | old session `expired` at Stripe; rows `EXPIRED`, `OPEN` |
| payment completion race | an already-paid open session → `409 payment_processing`. Asking again while the webhook is still pending is refused through Stripe's own subscription record (review finding). **Negative control** passed |
| orphan from a crash, before and after being paid | an unpaid orphan is expired before a new session; a paid one blocks |
| a request that outlives its reservation (slow Stripe) | the late request expires its own session and returns `409` (review finding). **Negative control** passed |
| at least Stripe's 30-minute minimum lifetime | lifetime measured at the Stripe call (review finding) |
| expired session releases the lock | time-based expiry and the `checkout.session.expired` webhook both release it |
| out-of-order and duplicate webhooks converge | subscription event before checkout completion, three concurrent redeliveries → applied once |
| a second paid subscription is never activated | outcome `duplicate_subscription`, audit written, `200` (no retry storm) |
| pre-existing tests | duplicate deliveries (sequential and concurrent), stale signatures, cross-tenant customer, historical price kept |

### 1.2 P0 — Forgot-password timing leak
**Problem.** For an existing account the request path did a database transaction plus a synchronous
email call; for an unknown address it did a dummy hash. The timing revealed which addresses had
accounts.

**Fix** (`auth/recovery.ts`, `core/jobs.ts`, `worker/index.ts`):
- The request path does only account-independent work: validation, per-IP and per-hashed-address rate
  limits, and one durable BullMQ job write. It then returns `200 {emailDelivery}`.
- The worker looks up the account, issues the token and sends the email.
- If the queue is unreachable, every address gets the same `503`.
- Job data (an address) is deleted on completion, or 24 h after a failure, and never logged.
- A failed provider send is retried by the queue; each retry voids the previous link (review finding).
- The worker returns no value, because BullMQ stores return values in Redis and "no_account" would
  reveal accounts. Found by inspecting Redis during the live run; fixed and re-verified.
- Queue keys are prefixed per environment, so test jobs can never reach a development worker.

**Evidence** (`email-invitations.test.ts`):
- **Identical responses.** Status, body and headers match for existing and unknown accounts (except
  `x-request-id`; `RateLimit-Reset` within ±1 s).
- **Timing.** With a deliberately slow 1.5 s email provider, both responses return in under 750 ms.
  Nothing account-specific happens before the response.
- **Negative control.** Putting the work back on the request path makes the test fail (≈1.6 s).
- Rate limits (`200, 200, 200, 429`) and validation errors are identical for both kinds of address.
- Queue outage → the same `503` for both.
- Retry on provider failure.
- **Live run against the real worker:** the existing account got a token and a delivery record, the
  unknown address got nothing, and Redis held no job data, outcomes or addresses afterwards.

### 1.3 Review finding — pre-account-hijack fix bypassable via the verification link (medium)
**Problem.** An attacker registers the victim's address. If the victim clicks the verification email,
the attacker's account becomes verified and can then link OAuth.

**Fix.** `POST /auth/email/verify` now requires the session of the account the link was issued for. The
verify page keeps the token across sign-in, and a localized prompt was added. The victim's way in is a
password reset, which clears links and MFA added before the address was proven.

**Evidence:**
- a test that inbox access alone (no session, or another account's session) cannot verify;
- the OAuth hijack regression test from the previous round;
- updated E1 case in the staging plan.

### 1.4 Tests can never touch a production database
- **Shared guard** (`tests/db-guard.ts`), used by vitest global setup, `resetDb` and a new Playwright
  global setup:
  - the database name must end in `_test` (integration) or `_e2e`/`_test` (E2E);
  - the host must be local, unless `ALLOW_REMOTE_TEST_DATABASE=1` is set;
  - the URL is never printed. The old guard echoed the full URL, credentials included.
- **Unit tests** (`tests/unit/db-guard.test.ts`).
- **Live refusals** before any connection, for:
  - a remote production-like URL;
  - the local dev database;
  - E2E with `DATABASE_URL` unset or pointing at a remote or dev database.
- Every local run used throwaway local databases; the environment's external database was never
  touched.

### 1.5 Migration atomicity (found during validation)
**Problem.** `prisma migrate deploy` runs a migration file **without** a transaction. Upgrading data
that violated a new constraint left a half-applied schema. An earlier `psql`-based check had suggested
otherwise, and that conclusion was wrong.

**Fix.** Both Phase 1.1 migrations are wrapped in `BEGIN`/`COMMIT`. Neither has left this sandbox, so
editing them is safe.

**Evidence:** the Phase 1 → 1.1 upgrade was run through `prisma migrate deploy` itself.

| Case | Result |
|---|---|
| A. Clean data | applied; data intact; no drift |
| B. Two live subscriptions in one organization | checkout migration rolled back completely; documented recovery (fix data → `migrate resolve --rolled-back` → deploy) succeeded |
| C. Cross-tenant legacy workspace | Phase 1.1 migration rolled back completely: no new tables, no composite FKs, data intact |

**Related fix.** The pre-check SQL had a bug: it used an enum value that doesn't exist yet on a Phase 1
database. It now compares `status::text` and was validated against a Phase 1 database containing bad
data (§5).

### 1.6 Earlier Phase 1.1 work (previous rounds; full list in `phase-1.1-audit.md`)
- **Security fixes:**
  - pre-account OAuth hijack;
  - `TRUSTED_PROXY_HOPS` required in production (fail closed);
  - OAuth `code`/`state` stripped from OpenTelemetry spans;
  - Sentry console breadcrumbs dropped;
  - Docker runtime crash for the non-root user fixed;
  - narrow-screen overflow fixed.
- **Delivered in the six existing commits:**
  - rate limiting and idempotency;
  - nonce CSP;
  - email, invitations and recovery;
  - Stripe;
  - OAuth;
  - observability;
  - tenant constraints;
  - global and mobile regression tests.

## 2. Test results

| Suite | Count | Failures |
|---|---|---|
| Unit + integration (Vitest, real PostgreSQL + Redis, `*_test` database) | **145** tests in 12 files | 0 (full suite twice, plus after recreating the test database from scratch) |
| End-to-end (Playwright, production build, real worker) | **19** tests in 2 specs | 0 |
| CI replica (clean copy, no `.env`) | 145 + 19 | 0 |

Breakdown by suite (from Vitest's JSON reporter):

| Suite | Tests |
|---|---|
| billing-stripe | 25 |
| global-pricing | 21 |
| security-core | 16 |
| email-invitations | 15 |
| rbac-tenancy | 15 |
| oauth | 9 |
| auth-events | 8 |
| api | 5 |
| unit: i18n | 12 |
| unit: core | 8 |
| unit: security-headers | 8 |
| unit: db-guard | 3 |

Concurrency suites (billing, rate limiting, recovery) were each run green 3× in a row.

## 3. Validation gates

| Gate | Locally verified | GitHub Actions |
|---|---|---|
| Typecheck (`next typegen && tsc`) | ✅ clean | ❌ not run |
| Lint (ESLint) | ✅ clean | ❌ |
| Unit + integration | ✅ 145/145 | ❌ |
| Production build | ✅ clean, 0 warnings | ❌ |
| E2E (CSP-violation watcher on every page; 4 global personas; tenant isolation; overflow at 390/768/1024/1440 in LTR and RTL; security headers) | ✅ 19/19 | ❌ |
| Migration drift (`prisma migrate diff --exit-code`) | ✅ none; also fails correctly on an un-migrated change | ❌ |
| Migration upgrade + failure atomicity via `prisma migrate deploy` | ✅ §1.5 | — |
| Docker: image builds; migrate, web and worker entrypoints; non-root; health ready | ✅ CI replica §3a | ❌ |
| Production fails closed without `TRUSTED_PROXY_HOPS` | ✅ unit test + container (readiness 500, log names the setting) | — |
| Tests cannot reach a non-disposable database | ✅ §1.4 | — |
| Secrets / debug code in diff | ✅ none (§9) | — |

### 3a. CI replica (copy of the working tree, no `.env`, throwaway databases)
Run 2026-10-15 16:33–16:47 UTC with the same commands as `.github/workflows/ci.yml`:

| Step | Result |
|---|---|
| install | `pnpm install --frozen-lockfile` ok |
| migrate + drift | ok; "No difference detected" |
| typecheck | ok |
| lint | ok |
| tests | 145/145 |
| build | ok |
| E2E | 19/19 |

Docker:
- **First attempt failed.** Docker Hub rate-limited the base-image lookup (`429`). The replica script
  wrongly carried on with an older local image, so those container results were **discarded**.
- **Strict re-run.** The script was made strict (the stale image is deleted first, and a build error
  aborts). The re-run used a fresh image built at 16:45, 2.2 GB, containing all three migrations:
  - **migrate entrypoint:** applies all three migrations to a fresh database;
  - **web without `TRUSTED_PROXY_HOPS`:** readiness `500`, and the log names the setting;
  - **web + worker with configuration:** both run as uid 1001; readiness is `ready`;
  - **forgot-password through the container:** `200`, and the containerized worker issued the reset
    token with no errors.
- **Sandbox-only overlay.** In this sandbox the image build needs an overlay Dockerfile that trusts the
  outbound proxy's CA. It lives outside the repository; the repository `Dockerfile` itself is used
  unchanged otherwise.

## 4. Remaining security risks and limitations

1. **Not real-provider verified.** Stripe (including Stripe Tax), Resend/Postmark and the three OAuth
   providers are tested against test doubles only. Run `staging-verification.md`.
2. **Not GitHub Actions verified.**
3. **Duplicate subscriptions created outside Realy** (e.g. in the Stripe dashboard) are blocked from
   activation and flagged, but refunding is manual (runbook in `billing.md`).
4. **The worker is required.** Without it, password-reset emails are queued but not sent (durable in
   Redis; delivered once the worker runs). Durability depends on Redis persistence (AOF recommended).
5. **RLS not enabled.** It needs a non-owner app role and per-request tenant transactions (Phase 2;
   `security.md` §10).
6. **Idempotency crash window.** A crash after a key is claimed blocks that key for 24 h; the client
   must use a new key.
7. **Rate-limit fallback.** The in-memory fallback is dev/test only. Production auth buckets fail
   closed if Redis is down.
8. **Lockout trade-off.** Per-account sign-in limits let a third party temporarily lock a known user
   out of password sign-in (by design).
9. **OAuth linking** doesn't require a recent MFA verification.
10. **Side effect of the hijack fixes:** without an email provider, password sign-ups can't verify,
    and so can't link OAuth.
11. **Sign-up reveals that an address is registered** (inherent to sign-up; rate-limited 10/h/IP).
    Password reset no longer does.
12. **CSP:** `style-src 'unsafe-inline'` remains, and PPR is disabled so the nonce works.
13. **No retention jobs** yet for expired sessions, `email_messages`, `stripe_events` and
    `checkout_sessions`.
14. **Not implemented:** breached-password check, usage metering, entitlement enforcement, TOTP QR
    code, enterprise SSO, PostHog.
15. **Docker image is about 2.2 GB** (§7).

## 5. Migration and deployment prerequisites

1. **PostgreSQL ≥ 12** (transactional `ALTER TYPE … ADD VALUE`); tested on 16. Redis 7 with
   persistence.
2. **Run the read-only pre-check** against the target database. Every row it returns must be fixed
   first:
   ```sql
   SELECT 'workspace in another org''s company' AS problem, w.id FROM workspaces w JOIN companies c ON c.id = w.company_id
    WHERE c.organization_id <> w.organization_id
   UNION ALL
   SELECT 'project in another org''s workspace/company', p.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id
    WHERE w.organization_id <> p.organization_id OR w.company_id <> p.company_id
   UNION ALL
   SELECT 'subscription item in another org''s subscription', i.id FROM subscription_items i JOIN subscriptions s ON s.id = i.subscription_id
    WHERE s.organization_id <> i.organization_id
   UNION ALL
   SELECT 'organization with more than one live subscription', s.organization_id FROM subscriptions s
    WHERE s.status::text IN ('ACTIVE','TRIALING','PAST_DUE','INCOMPLETE','UNPAID','PAUSED')
    GROUP BY s.organization_id HAVING count(*) > 1;
   ```
3. **Back up the database**, then run migrations as a release step:
   `node_modules/.bin/prisma migrate deploy` (Docker: the `migrate` entrypoint). The Phase 1.1
   migrations are atomic. If one fails: fix the data, run
   `prisma migrate resolve --rolled-back <migration>`, then deploy again.
4. **Data effects.** The migration empties `idempotency_keys` (a table Phase 1 never wrote). No other
   data is changed.
5. **Deploy web and worker together.** The worker now also sends password-reset email.
6. **Behind a proxy that appends `X-Forwarded-For`,** set `TRUSTED_PROXY_HOPS` accordingly.
7. **Stripe webhook endpoint** `{APP_URL}/api/v1/webhooks/stripe`, subscribed to the 10 events listed
   in `staging-verification.md` §2.1. `checkout.session.expired` is new in this round.
8. **OAuth redirect URIs** `{APP_URL}/api/v1/auth/oauth/{google|github|microsoft}/callback`.
9. **After deploy:** `GET /api/health/ready`, check Admin → System, run the staging plan.

## 6. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REALY_ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`); different per environment |
| `NODE_ENV` | yes in production | `production` (set by `next start`; set it for the worker too) |
| `TRUSTED_PROXY_HOPS` | **yes in production** | number of proxies appending to `X-Forwarded-For`; startup fails if unset |
| `APP_URL` | yes in production | public HTTPS origin (default `http://localhost:3000`) |
| `REDIS_URL` | yes in production | default `redis://localhost:6379`; rate limits, outbox relay, auth-email queue |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional | without them: "Billing is not configured." |
| `STRIPE_AUTOMATIC_TAX` | optional | `true`/`false` (default `false`) |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | optional | `resend` or `postmark`; without them: delivery NOT_CONFIGURED |
| `OAUTH_GOOGLE_CLIENT_ID/_SECRET`, `OAUTH_GITHUB_CLIENT_ID/_SECRET`, `OAUTH_MICROSOFT_CLIENT_ID/_SECRET` | optional | per provider; without them: "OAuth provider not configured." |
| `OAUTH_MICROSOFT_TENANT` | optional | default `common` |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | optional | errors only, no PII |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | optional | traces; URL queries stripped |
| `LOG_LEVEL`, `REALY_SERVICE` | optional | logging level; service label (`worker` for the worker) |
| `REALY_DEV_RELAX_MFA` | dev only | refused when `NODE_ENV=production` |
| `ALLOW_REMOTE_TEST_DATABASE` | tests only | `1` only for a dedicated disposable remote test database |

## 7. Docker image-size recommendation (not implemented)
The image is about 2.2 GB because the runtime stage copies the whole build stage: dev dependencies,
sources and the build cache. Recommended changes, in order of effect:

1. **Next.js standalone output.** Set `output: "standalone"` and copy only `.next/standalone`,
   `.next/static` and `public`. This removes most of `node_modules`.
2. **Compile the worker** (esbuild or tsup) into one bundled `dist/worker.js` and run it with `node`.
   This drops `tsx` and TypeScript sources from the runtime.
3. **Keep a separate migrate image or stage** with the Prisma CLI and `prisma/`, so the web and worker
   images don't ship the CLI.
4. **Production dependencies only:** `pnpm deploy --prod`, or `pnpm prune --prod` after building.
5. **Slim base image.** Keep `node:22-bookworm-slim` (or move to a distroless base) and ensure
   `.dockerignore` keeps tests, docs and caches out.

Expected size: roughly 250–400 MB for web and worker. It must be re-validated with the same container
checks (migrate, web, worker, fail-closed).

## 8. Staging verification
`docs/staging-verification.md` covers the exact setup, test cases (Stripe S1–S14, email E1–E8, OAuth
O1–O9) and an evidence template for real-provider verification. It uses dedicated staging
credentials, Stripe test mode only, and keeps secrets in the secret manager only.

## 9. Git state and review

**Commits.** Six local, unpushed commits (`d855189` … `dccf85e`), verified with `git fsck`. The remote
branch is an ancestor of HEAD, so the push will fast-forward with no force. All commits use the
environment's configured identity (`Claude <noreply@anthropic.com>`), like every earlier commit on
this branch.

**Uncommitted changes, awaiting approval:**
- source: billing, auth (recovery, OAuth), core (env, jobs, observability), worker, UI (form errors,
  verify page, OAuth buttons), i18n (5 catalogs);
- migrations: one new, one wrapped in a transaction; schema;
- tests: guard, helpers, 5 suites, E2E global setup;
- CI workflow, Dockerfile, `.env.example`;
- docs: API, security, billing, database, architecture, roadmap, README, audit, this report, staging
  plan.

**Review evidence.** Full diff read; an independent review of the full Phase 1.1 diff (previous round)
and of this round's fixes, with every finding fixed (§1). Scan of added lines: no secrets, no debug
code, no `.only`.

**Not committed:** `.env` (git-ignored) and the sandbox-only Docker CA overlay (lives outside the
repo).

Proposed commits after approval:
1. billing: double-billing protection;
2. auth: queued password reset and session-bound email verification;
3. auth: pre-account-hijack fixes and production proxy requirement;
4. observability privacy;
5. tests: database guard;
6. migrations: atomic;
7. CI and Docker;
8. docs and reports.
