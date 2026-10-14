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

* **Passwords** — argon2id (`m=19 MiB, t=2, p=1` minimum, OWASP 2024+), length 12–256, checked
  against a breached-password list in production (k-anonymity HIBP API, Phase 1.1).
* **Sessions** — 256-bit random token in cookie `realy_session` (`HttpOnly; Secure; SameSite=Lax;
  Path=/`); only `SHA-256(token)` stored. Absolute lifetime 30 days, idle timeout 7 days (sliding,
  `last_seen_at` updated at most every 5 min). Revocable individually or all-at-once.
* **MFA** — TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step) with secret encrypted at rest;
  10 single-use recovery codes stored hashed. WebAuthn/passkeys reserved (`mfa_factors.type`).
  Sign-in with MFA enabled creates a session in `mfa_pending` state that can only call `/mfa/verify`.
  Replayed TOTP codes within their window are rejected (`last_used_step`).
* **OAuth login** — provider abstraction (Google, GitHub, Microsoft); PKCE + state; providers without
  configured credentials return `not_configured` (no fake buttons that succeed).
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

* TLS everywhere; HSTS; secure headers (CSP with nonces, `X-Content-Type-Options`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, frame-ancestors none).
* **Secrets**: application secrets from the platform secrets manager (env injection), never in the
  repo (`.env*` git-ignored; `.env.example` contains names only). Tenant secrets (OAuth tokens, API
  keys, TOTP secrets) encrypted with AES-256-GCM using a data key derived per purpose from
  `REALY_ENCRYPTION_KEY` (32 bytes, base64) in Phase 1; replaced by KMS envelope encryption with key
  rotation (`key_version` stored in every ciphertext header) before GA.
* **Logs** redact `password`, `token`, `secret`, `authorization`, `cookie`, `apiKey` fields.
* PostgreSQL RLS (Phase 2): app connects as `realy_app`; each transaction does
  `SET LOCAL realy.org_id = '<uuid>'`; policies `USING (organization_id = current_setting('realy.org_id')::uuid)`.
  Platform workers use a separate role with explicit `BYPASSRLS` only where required.
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
Redis token buckets per IP and per principal for auth endpoints (e.g. sign-in 10/min/IP,
5/min/account), API (per plan), and per-agent tool calls. Account lockout is soft (exponential delay)
to avoid lockout-DoS.

## 8. Audit
Every administrative and security-relevant action writes `audit_logs` (actor, action, resource,
old/new value, reason, request id, IP, user agent) in the same transaction as the change.
Critical actions (rbac.md §4) require an MFA-verified session.
