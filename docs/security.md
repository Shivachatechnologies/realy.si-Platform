# Realy — Security Architecture

> Status: **Frozen for Phase 1.** Principle: *the AI model is never the security boundary.*

## 1. Threat model (summary)

| Asset | Threats | Primary controls |
|---|---|---|
| Tenant data | cross-tenant access, IDOR | tenant-resolved context, org-filtered queries, 404-on-foreign-id, RLS (defense-in-depth), isolation tests |
| Accounts | credential stuffing, session theft | argon2id, rate limits, MFA, HttpOnly/Secure/SameSite cookies, hashed session tokens, session revocation |
| Provider credentials | exfiltration by agents / XSS / logs | AES-256-GCM envelope encryption, never sent to browser or model, short-lived scoped tokens via Realy Connect, log redaction |
| Money / ownership | unauthorized transfer, prompt-injected actions | FOUNDER-ONLY autonomy level, approvals, MFA, policy engine outside the model |
| Platform config (pricing) | malicious or mistaken admin change | scoped RBAC, MFA-gated permissions, immutable price history, admin audit log |
| Agents | prompt injection, tool abuse, runaway loops/cost | untrusted-content separation, tool-level authorization, budgets, max iterations, kill switch |
| Sandboxes | escape, lateral movement | per-run isolated microVM/containers, egress allow-lists, no host credentials, resource limits |

## 2. Authentication

* **Passwords** — argon2id (`m=19 MiB, t=2, p=1` minimum, OWASP 2024+), length 12–256. A breached-password
  check (k-anonymity HIBP API) is **not implemented** yet (deferred to Phase 2).
* **Password reset** _(implemented)_ — single-use token (SHA-256 stored), 30 min, delivered only by
  email as a URL **fragment** (`#token=`, never sent to servers or logged in access logs); the
  request endpoint does no account-dependent work: it validates, applies the per-IP and per-account
  (hashed address) limits — identical for existing and unknown accounts — and enqueues a job; the
  worker looks the account up, issues the token and sends the email. Status, body, headers and timing
  are therefore the same either way (regression test with a deliberately slow email provider). Job data
  (the address) lives in Redis only until the job completes (24 h after a failure) and is never logged.
  A reset rejects the current password, marks the email verified and revokes every session.
* **Email verification** _(implemented)_ — 24 h single-use fragment links; a token issued for a
  previous address is rejected. The link only works while **signed in to the account it was issued
  for**: inbox access alone must not confirm an account someone else registered with that address
  (the address owner takes such an account over with a password reset, which clears credentials
  added before the address was proven).
* **Sessions** — 256-bit random token in cookie `realy_session` (`HttpOnly; Secure; SameSite=Lax;
  Path=/`); only `SHA-256(token)` stored. Absolute lifetime 30 days, idle timeout 7 days (sliding,
  `last_seen_at` updated at most every 5 min). Revocable individually or all-at-once.
* **MFA** — TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step) with secret encrypted at rest;
  10 single-use recovery codes stored hashed. WebAuthn/passkeys reserved (`mfa_factors.type`).
  Sign-in with MFA enabled creates a session in `mfa_pending` state that can only call `/mfa/verify`.
  Replayed TOTP codes within their window are rejected (`last_used_step`).
* **MFA brute force** — per-IP and per-session limits on `/mfa/verify`; the 5th wrong code revokes the
  pending session (`auth.mfa_locked` audit); every failure is audited.
* **OAuth login** _(implemented, Phase 1.1)_ — Google, GitHub, Microsoft (`src/server/modules/auth/oauth.ts`).
  `state` + PKCE S256 verifier live in an AES-GCM-encrypted, HttpOnly, SameSite=Lax cookie scoped to
  `/api/v1/auth/oauth` for 10 minutes and are checked before the code is exchanged. Account-takeover
  protections: an OAuth identity is **never auto-linked** to an existing account by email (the user
  must sign in and link from Settings → Security); a new account is created only from a
  provider-verified email; Microsoft's `email` claim is never trusted (nOAuth); an identity linked to
  one account cannot be linked to another; MFA still applies after OAuth sign-in. Pre-account
  hijacking: linking requires a **verified** email (checked at start and again when the link is
  written), and a password reset on an account whose email was never verified removes every OAuth
  link and MFA factor created before the owner proved the address (audited as
  `auth.unverified_credentials_cleared`). Providers without
  credentials show a disabled button labelled "OAuth provider not configured." and the start endpoint
  redirects back with `oauthError=not_configured` without contacting the provider.
* **Enterprise SSO** — SAML 2.0 / OIDC per organization (verified domains → IdP), JIT provisioning,
  SCIM (Phase 7). Feeds the same session model.
* **API keys** — `rk_live_<prefix>_<secret>`; store prefix + SHA-256; bound to a service account.
* **CSRF** — SameSite=Lax cookies + `Origin`/`Host` verification on every state-changing request.

## 3. Authorization
See `rbac.md`. Pipeline for every action:
`Authentication → Tenant resolution → RBAC → Permission → Resource scope → Risk policy → Budget policy → Approval → Execution`.
Phase 1 implements the first five; risk/budget/approval arrive with the Tool Gateway (Phase 3) and
are mandatory for every agent action.

## 4. Data protection

* TLS everywhere; HSTS (production); static headers on every response (`next.config.ts`,
  `src/server/core/security-headers.ts`): `X-Content-Type-Options`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy`; `X-Powered-By` is removed.
* **CSP** _(implemented, Phase 1.1)_ — pages get a per-request nonce policy from `src/proxy.ts`:
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`/`unsafe-eval` in production),
  `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Next.js
  applies the nonce to every script it renders. API responses get `default-src 'none'`.
  Trade-offs, stated plainly: (1) a nonce requires per-request rendering, so Cache Components /
  Partial Prerendering is **disabled** (Next.js cannot put a per-request nonce into a prerendered
  shell); (2) `style-src` still allows `'unsafe-inline'` because React/Next inject inline styles —
  style injection is a much smaller risk than script injection but it is an exception. Verified by
  E2E: every Playwright test fails on any CSP violation report, and a header test checks that every
  rendered `<script>` carries the request's nonce.
* **Secrets**: application secrets from the platform secrets manager (env injection), never in the
  repo (`.env*` git-ignored; `.env.example` contains names only). Tenant secrets (OAuth tokens, API
  keys, TOTP secrets) encrypted with AES-256-GCM using a data key derived per purpose from
  `REALY_ENCRYPTION_KEY` (32 bytes, base64) in Phase 1; replaced by KMS envelope encryption with key
  rotation (`key_version` stored in every ciphertext header) before GA.
* **Logs** redact `password`, `token`, `secret`, `authorization`, `cookie`, `apiKey` fields.
* PostgreSQL RLS is **not enabled** — see §10 for the protection chain that is in place and why RLS
  was deferred rather than added for show.
* Backups: managed Postgres PITR (≥ 14 days), daily snapshots to a separate account/region;
  quarterly restore drills. RPO ≤ 5 min, RTO ≤ 1 h (documented in runbooks).

## 5. AI security

* **Instruction hierarchy, structurally separated** in every model call:
  1. system instructions (Realy runtime, immutable),
  2. company instructions (admin-authored policies),
  3. task instructions (from the objective/plan),
  4. **untrusted content** (emails, documents, web pages, tool output) — wrapped in delimited blocks
     with provenance metadata, never concatenated into instruction positions, and the model is told
     it is data.
* Tools enforce permissions independently; a tool call requested because of injected text still
  fails RBAC/policy if not allowed, and SUPERVISED / FOUNDER-ONLY actions still need a human.
* Exfiltration controls: outbound tools (send_email, http_request, publish) are SUPERVISED by
  default; egress domain allow-lists per company; DLP checks on outbound payloads for secrets and
  bulk personal data (Phase 5).
* Autonomy levels: AUTONOMOUS (research, analysis, drafts, internal organization), SUPERVISED
  (publishing, external communication, production deploy, ad spend, large config changes),
  FOUNDER_ONLY (money movement, ownership/equity, major legal commitments, banking, company closure).
  Each tool declares its level; companies may tighten but never loosen FOUNDER_ONLY.
* Founder controls at all times: approve, reject, pause, cancel, **kill** (company-wide kill switch
  stops all agent runs and revokes in-flight sandbox sessions within seconds).

## 6. Browser / computer sandboxes (Phase 5)

Per-run isolated environments (Firecracker microVMs or gVisor containers) in a separate cluster/VPC:
no host mounts, no cloud metadata endpoint, egress via filtering proxy with per-company allow-lists,
CPU/memory/disk/time limits, credentials injected per-session from Realy Connect with minimal scope,
full session recording (screenshots + action log), destroyed after the run.

## 7. Abuse & rate limiting
Implemented (Phase 1.1, `src/server/core/rate-limit.ts`, presets in `limits.ts`): sliding-window
counters in Redis via one atomic Lua script, so limits hold across any number of app instances and
under concurrent bursts (tested). Buckets: sign-up, sign-in (per IP **and** per account), MFA (per IP
and per session), password reset (per IP and per account), email verification, OAuth, invitations,
admin, billing, tenant writes, public reads. Client IP = the entry appended by our own proxy
(`TRUSTED_PROXY_HOPS`, default 1, counted from the right of `X-Forwarded-For`); the client-supplied
left-most value is ignored, so spoofing it does not escape a limit. Responses carry `RateLimit-*`
headers; denials add `Retry-After`. `TRUSTED_PROXY_HOPS` must be set explicitly in production (startup
fails otherwise): Next.js passes a client-supplied `X-Forwarded-For` through when no proxy is in
front, and route handlers cannot see the socket address, so the app must run behind at least one
proxy that appends to the header. With `0` every client shares one per-IP bucket (per-account and
per-session limits still apply).

Store failure policy: in production, authentication-class buckets fail **closed** (`503`, security
event logged) and the rest fail open. Outside production a per-process in-memory fallback is used —
it is **not** shared between instances and must never be relied on in production.

Not implemented: soft exponential delay, per-plan API limits (Phase 7), per-agent tool-call limits
(Phase 3).

## 8. Audit
Every administrative and security-relevant action writes `audit_logs` (actor, action, resource,
old/new value, reason, request id, IP, user agent) in the same transaction as the change.
Critical actions (rbac.md §4) require an MFA-verified session.

## 9. Observability and privacy (Phase 1.1)

* **Errors** — Sentry (`@sentry/node`), enabled only when `SENTRY_DSN` is set. All SDK data collection
  is switched off (cookies, headers, bodies, query strings, user info, DB query data, stack-frame
  variables); `beforeSend` deletes `request`/`user` and scrubs `extra`; HTTP breadcrumbs are dropped;
  tracing is off in Sentry (`tracesSampleRate: 0`, no Sentry OpenTelemetry setup).
* **Traces** — OpenTelemetry via `@vercel/otel`, registered only when `OTEL_EXPORTER_OTLP_ENDPOINT` is
  set; otherwise the OTel API is a no-op. Application spans and security events pass through `scrub`
  (drops keys containing password/secret/token/authorization/cookie/apikey/otp/email/signature/code,
  keeps primitives only).
* Neither backend is required: without configuration they report `not_configured` (startup log and
  Admin → System) and nothing is sent anywhere.
* Secrets that travel in URLs are avoided by design: password-reset, verification and invitation
  tokens are URL fragments. The OAuth callback necessarily carries `code`/`state` in its query, and
  Next.js' own server span records the raw request URL (`http.target`); the `stripUrlQueries` span
  processor removes query strings from `http.target`/`http.url`/`url.full` (and redacts `url.query`)
  before export. Verified by exporting to a local OTLP sink: no passwords, emails, cookies, OAuth
  codes/state or query values were present.
* Sentry was verified the same way (real SDK → local envelope sink): user, IP, breadcrumbs, request
  data and sensitive `extra` keys are absent; the error and request id remain. HTTP, fetch and
  console breadcrumbs are dropped.

## 10. Tenant isolation — protection chain and the RLS decision

What protects one organization's data from another today:

1. **Authentication** — opaque session → user.
2. **Tenant resolution** — the organization id comes from the URL and is re-verified against an
   active membership on every request; foreign ids return `404` (never `403`), so existence does not
   leak.
3. **RBAC with scopes** — every service function calls `requirePermission` against the
   organization → company → workspace chain before touching data.
4. **Scoped queries** — every tenant query filters by `organization_id` resolved in step 2.
5. **Database constraints** — composite foreign keys make cross-tenant references impossible to
   store: a workspace's company, a project's workspace/company and a subscription item's
   subscription must belong to the same organization (`(id, organization_id)` keys).
6. **Tests** — integration negative tests (foreign ids, removed members, scoped roles, cross-tenant
   Stripe objects) and E2E cross-tenant read/write attempts between four tenants.

**RLS decision.** Row-Level Security was evaluated and **not enabled** in Phase 1.1. It only adds
protection if (a) the application connects as a non-owner, non-superuser role and (b) every query runs
inside a transaction that sets the tenant (`SET LOCAL`). Neither holds yet: migrations and the app share
one owner role, and requests use pooled connections without per-request transactions. Policies added
now would be silently bypassed — security theatre. Plan (Phase 2): a separate `realy_app` role without
`BYPASSRLS`, a request-scoped transaction wrapper that sets `realy.org_id`, policies on tenant
tables, and tests that prove a query without the setting returns nothing.
