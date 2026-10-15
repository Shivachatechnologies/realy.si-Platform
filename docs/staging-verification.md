# Staging Verification — Real Providers (Phase 1.1)

Purpose: exercise Stripe (test mode), email delivery (Resend or Postmark) and Google / GitHub /
Microsoft OAuth against the real providers before Phase 1.1 is approved. Until every section below is
signed off, those integrations count as **implemented and locally tested, not real-provider verified**.

## 0. Rules

- **Dedicated staging only.** Its own database, Redis, domain and provider accounts/apps. Never point
  staging at production data, and never use production keys anywhere in this guide.
- **Stripe: test-mode keys only** (`sk_test_…`, `whsec_…` from a *test-mode* endpoint). A live key
  (`sk_live_…`) must never be configured on staging.
- **Secrets live in the platform's secret manager**, injected as environment variables. Never commit
  them, never paste them into tickets, chat, reports or screenshots. Evidence records (§6) contain ids
  and outcomes only.
- Run staging as production does: `NODE_ENV=production`, HTTPS, behind the real proxy/load balancer.

## 1. Staging prerequisites

| Item | How to verify |
|---|---|
| Commit under test | record the git SHA (`git rev-parse HEAD`) in the evidence record |
| Database migrated | run the pre-checks in `phase-1.1-final-report.md` (Migration prerequisites), then `node_modules/.bin/prisma migrate deploy` (Docker: the `migrate` entrypoint) |
| Web and worker running | `GET /api/health/ready` → `{"status":"ready"}`; worker log shows `worker started`. The worker is **required**: it sends password-reset email |
| Proxy topology | `TRUSTED_PROXY_HOPS` = number of proxies that append to `X-Forwarded-For` (startup fails if unset) |
| Admin → System | shows each provider as configured once its variables are set (booleans only) |

Environment variables (values from the secret manager; names exactly as below):

```
NODE_ENV=production
DATABASE_URL=…            # staging database
REDIS_URL=…               # staging Redis
REALY_ENCRYPTION_KEY=…    # 32 random bytes, base64 — staging-only key
APP_URL=https://staging.example        # the public HTTPS origin
TRUSTED_PROXY_HOPS=1                   # match the real proxy chain
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_AUTOMATIC_TAX=false             # true only once Stripe Tax is set up in the test account
EMAIL_PROVIDER=resend                  # or postmark
EMAIL_API_KEY=…
EMAIL_FROM="Realy <no-reply@mail.staging.example>"   # address on a verified sending domain
OAUTH_GOOGLE_CLIENT_ID=…   OAUTH_GOOGLE_CLIENT_SECRET=…
OAUTH_GITHUB_CLIENT_ID=…   OAUTH_GITHUB_CLIENT_SECRET=…
OAUTH_MICROSOFT_CLIENT_ID=… OAUTH_MICROSOFT_CLIENT_SECRET=… OAUTH_MICROSOFT_TENANT=common
SENTRY_DSN=…               # optional: a staging Sentry project
SENTRY_ENVIRONMENT=staging
OTEL_EXPORTER_OTLP_ENDPOINT=…   # optional
```

## 2. Stripe (test mode)

### 2.1 Setup
1. In the Stripe dashboard, switch to **Test mode**. Create a secret key → `STRIPE_SECRET_KEY`.
2. Developers → Webhooks → add endpoint `{APP_URL}/api/v1/webhooks/stripe` with exactly these
   events: `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_succeeded`,
   `invoice.payment_failed`. Copy its signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → Customer portal: enable payment-method update, invoice history and
   cancellation (the portal is created per request; there is nothing to configure in Realy).
4. Seed the staging catalog through the Admin pricing console (the dev catalog is refused in
   production). Realy creates Stripe products/prices lazily at the first checkout.

### 2.2 Test cases
Use Stripe's test cards: `4242 4242 4242 4242` (succeeds), `4000 0025 0000 3155` (3-D Secure),
`4000 0000 0000 0341` (attaches, later charges fail), `4000 0000 0000 0002` (declined).

| # | Steps | Expected |
|---|---|---|
| S1 | Org owner (MFA on), confirm billing country IN, Founder monthly → Continue to payment, pay with 4242 | Redirect shows "Payment submitted…". Within seconds the billing page shows the subscription (TRIALING for 14-day trial). `checkout_sessions` row COMPLETED; one `subscriptions` row; audit `billing.subscription.created`; `stripe_events` rows with outcome `applied` |
| S2 | Before paying S1, double-click Continue and open the button in a second tab/admin | Every response has the **same** checkout URL or a `409` "already being started"; Stripe dashboard shows **one** open session for the customer |
| S3 | Open a monthly checkout, then request yearly | First session shows **Expired** in Stripe; a new session for yearly opens |
| S4 | Open checkout in tab A, pay it, then quickly request a different plan in tab B | Tab B gets `409` "payment … is being confirmed"; no new session in Stripe |
| S5 | Pay with 4000 0025 0000 3155 and complete 3-D Secure | Same as S1 |
| S6 | Pay with 4000 0000 0000 0002 | Stripe shows decline; Realy shows no subscription |
| S7 | Leave a session unpaid for 31 minutes | Stripe sends `checkout.session.expired`; row EXPIRED; a new checkout is allowed |
| S8 | Stripe dashboard → Webhooks → resend an already delivered event | `200` with `duplicate: true`; no second subscription or audit entry |
| S9 | Subscribed org requests checkout again | `409` "already has a subscription" |
| S10 | Manage billing → portal: update card to 4000 0000 0000 0341; in the dashboard end the trial now | `invoice.payment_failed` → status PAST_DUE, `last_payment_failed_at` set; then update to 4242 and pay the invoice → ACTIVE |
| S11 | Portal → cancel at period end | `cancel_at_period_end` true, UI shows the date; dashboard "cancel immediately" → CANCELED |
| S12 | Create a second subscription for the same customer in the dashboard (simulates a bypass) | Webhook `200` outcome `duplicate_subscription`; no second live row; SECURITY audit `billing.subscription.duplicate_blocked`; then cancel + refund it in Stripe (runbook in billing.md §6) |
| S13 | Send a request to the webhook URL with a wrong signature (e.g. `curl -X POST -H 'stripe-signature: t=1,v1=bad' …`) | `400`; nothing recorded |
| S14 | Admin changes the India Founder price | New version; existing subscriptions keep their item price; new checkouts use the new price |

SQL spot checks (read-only):
```sql
SELECT status, count(*) FROM checkout_sessions GROUP BY status;
SELECT organization_id, count(*) FROM subscriptions
 WHERE status IN ('ACTIVE','TRIALING','PAST_DUE','INCOMPLETE','UNPAID','PAUSED')
 GROUP BY organization_id HAVING count(*) > 1;            -- must return no rows
SELECT outcome, count(*) FROM stripe_events GROUP BY outcome;
```

## 3. Email (Resend or Postmark)

### 3.1 Setup
- **Resend:** add and verify a sending domain (SPF + DKIM records), create an API key with
  *sending access* only → `EMAIL_API_KEY`, `EMAIL_PROVIDER=resend`.
- **Postmark:** create a server, verify the sender domain (DKIM + Return-Path), use the **server API
  token** → `EMAIL_API_KEY`, `EMAIL_PROVIDER=postmark` (messages go to the `outbound` stream).
- `EMAIL_FROM` must be on the verified domain. Use real inboxes you control (one per test persona).

### 3.2 Test cases
| # | Steps | Expected |
|---|---|---|
| E1 | Sign up | Verification email arrives; link is `{APP_URL}/{locale}/verify-email#token=…` (token in the **fragment**); clicking it in the signed-in browser verifies; in a signed-out (private) window it asks to sign in first, then verifies; signed in as a *different* account it reports the link as invalid; `email_messages` status SENT |
| E2 | Forgot password for an existing address, and for an address with no account | Identical API response (body, status, headers; compare timings with `curl -w '%{time_total}'` over several runs); only the existing address receives an email; the link resets the password once and signs out all sessions |
| E3 | Stop the worker, request a reset, start the worker | Email arrives after the worker starts (job is durable in Redis) |
| E4 | Invite a member (role ≤ yours) | Email arrives; accept page works only for the invited address; inviter whose permission is removed before acceptance → invitation is refused |
| E5 | Resend, then revoke an invitation | Resend rotates the link (old link fails); revoked link fails |
| E6 | Arabic (ar-AE) user triggers E1/E2 | Email renders right-to-left and in Arabic |
| E7 | Temporarily set a wrong `EMAIL_API_KEY` | Invitation shows "Email failed" (status FAILED); nothing claims success; restore the key |
| E8 | Inspect provider dashboard and logs | No token appears in logs, Sentry or traces (only in the delivered email) |

## 4. OAuth

Redirect URIs (must match exactly, including scheme and no trailing slash):
`{APP_URL}/api/v1/auth/oauth/google/callback`, `…/github/callback`, `…/microsoft/callback`.

### 4.1 Setup
- **Google:** Google Cloud console → APIs & Services → OAuth consent screen (External, *Testing*,
  add your test users) → Credentials → OAuth client ID (*Web application*), add the redirect URI.
  Scopes requested by Realy: `openid email profile`.
- **GitHub:** Settings → Developer settings → OAuth Apps → New, callback URL as above. Scopes
  requested: `read:user user:email`.
- **Microsoft:** Entra ID → App registrations → New (Web platform, redirect URI as above), supported
  account types per `OAUTH_MICROSOFT_TENANT` (`common` = work/school + personal). Certificates &
  secrets → new client secret. Scopes requested: `openid email profile`.

### 4.2 Test cases (repeat per provider where it applies)
| # | Steps | Expected |
|---|---|---|
| O1 | Sign in with a provider whose email has no Realy account | Account created (Google/GitHub with a verified email); lands in onboarding |
| O2 | Microsoft sign-in for a new email | Refused with "did not confirm this email" (Microsoft's email claim is never trusted for account creation) |
| O3 | Provider sign-in whose email matches an existing password account | "An account with this email already exists…" — no automatic linking |
| O4 | Signed in with a verified email → Settings → Security → connect provider | Linked; signing out and in with the provider reaches the same account; MFA is still required if enabled |
| O5 | Account with an **unverified** email tries to connect a provider | "Verify your email address before connecting…" |
| O6 | Connect a provider identity already linked to another account | "already connected to another Realy account" |
| O7 | Cancel at the provider's consent screen | Back on sign-in with a provider error; no account created |
| O8 | Tamper with `state` in the callback URL, or replay an old callback URL | Refused (`state_mismatch`) |
| O9 | Remove one provider's variables and restart | Its button reads "OAuth provider not configured." and is disabled |

## 5. Observability (optional but recommended)
- Trigger a server error in staging (e.g. temporarily stop the database, load a page, restore) and
  confirm the Sentry event has **no** cookies, headers, request bodies, user email or IP.
- In the OTLP backend, find the OAuth callback span: `http.target` must have **no query string**.

## 6. Evidence record (one per run; no secrets)

```
Date / time (UTC):
Commit SHA:
Environment: staging (URL)
Operator:
Stripe:  S1 … S14  pass/fail, Stripe object ids (cs_/sub_/evt_), notes
Email:   E1 … E8   pass/fail, provider message ids, notes
OAuth:   O1 … O9   pass/fail per provider, notes
Observability: pass/fail, notes
Open issues:
```

Phase 1.1 may be marked **real-provider verified** only when every row passes (or a failure is
fixed, re-tested and recorded).
