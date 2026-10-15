# Realy — Implementation Roadmap

Each phase ends only when its exit criteria are verified by automated tests, type checking, lint,
migrations and a manual UI pass (desktop + mobile, LTR + RTL). "Done" means working end-to-end.

## Phase 0 — Architecture ✅
Repository inspected (empty — greenfield). Frozen: database conventions, API conventions, event
envelope, agent protocol, tool protocol, permissions, globalization, pricing, billing, security,
design system (tokens in `src/app/globals.css`, primitives in `src/components/ui`).

## Phase 1 — Foundation ✅ (core) · 1.1 items listed below

Status as of 2026-10-14. ✅ = implemented and covered by automated tests.

| Module | Delivered | Verified by |
|---|---|---|
| Tooling | ✅ Next.js 16 (Cache Components/PPR disabled in 1.1 for nonce CSP), TS strict, Tailwind 4, Prisma 7 + pg adapter, Vitest, Playwright, ESLint, Docker/Compose, CI workflow | build, typecheck, lint in CI |
| Identity | ✅ sign-up/in/out, argon2id, hashed DB sessions (absolute + idle expiry), TOTP MFA with replay protection, single-use recovery codes, MFA-pending sessions | `auth-events.test.ts`, E2E |
| Tenancy | ✅ organizations, memberships, invitations (single-use, addressee-bound), companies with independent country dimensions, workspaces, projects | `rbac-tenancy.test.ts`, E2E |
| RBAC | ✅ 59 permissions, 15 system roles, custom roles, 7 scope levels, no-escalation, MFA-gated critical permissions, AI-identity restrictions, 404-on-foreign-tenant | `rbac-tenancy.test.ts` |
| Globalization | ✅ en-US, hi-IN, ar-AE (RTL), de-DE, zh-CN; locale negotiation; Intl formatting; 17 countries, 8 regions, 12 currencies, tax configs; logical-CSS and no-hardcoded-text guards | `i18n.test.ts`, `global-pricing.test.ts`, E2E |
| Pricing/Billing foundation | ✅ catalog, COUNTRY→REGION→GLOBAL resolution, immutable versioning (DB-enforced), entitlements, promotions/coupons, billing profile with explicit country confirmation, regional quote, subscriptions locked to price versions | `global-pricing.test.ts`, E2E |
| Admin foundation | ✅ Admin Console: pricing console, countries/regions, feature flags, platform audit log; audited bootstrap CLI for the first platform admin | E2E |
| Audit + events | ✅ same-transaction audit (append-only, DB-enforced) and outbox; relay worker → BullMQ | `auth-events.test.ts`, live worker run |
| Feature flags | ✅ GLOBAL/REGION/COUNTRY/PLAN/ORG/COMPANY/USER targeting | `core.test.ts`, `global-pricing.test.ts` |
| Experience | ✅ Command Center (real company profile, activity, health, setup; honest empty states), navigation per spec, ⌘K palette, mobile drawer | E2E incl. mobile overflow checks |

### Phase 1.1 — production hardening (see `phase-1.1-final-report.md` for verification status)
Implemented in code and covered by automated tests; external services work only once credentials
are configured, and **none has been exercised against a live provider account yet**:
* Stripe Checkout, customer portal, signature-verified idempotent webhooks driving the subscription
  lifecycle (`billing-stripe.test.ts`, against a gateway double).
* Email provider abstraction (Resend, Postmark), invitation/verification/password-reset emails,
  invitation list/revoke/resend, inviter re-validation at acceptance (`email-invitations.test.ts`).
* OAuth login — Google, GitHub, Microsoft — with state + PKCE and takeover-safe linking (`oauth.test.ts`).
* Idempotency keys; distributed sliding-window rate limits with trusted client IP; per-account and
  per-session limits; MFA attempt cap; body-size limits (`security-core.test.ts`).
* Nonce CSP; composite-FK tenant constraints; OpenTelemetry + Sentry (opt-in, privacy-scrubbed);
  Admin → System configuration status.

Still open (moved to Phase 2 unless noted):
* PostgreSQL RLS — deferred with reasons in `security.md` §10.
* Enterprise SSO (SAML/OIDC, Phase 7); breached-password check; PostHog analytics abstraction.
* Usage metering writers (table exists), entitlement enforcement (e.g. `companies.max`).
* QR code for TOTP enrollment (setup key and `otpauth://` link are shown today).

## Phase 2 — Company OS
Company Graph (`graph_edges` + typed relations), Company Brain (documents → S3, ingestion workers,
chunking, embeddings via provider abstraction, pgvector HNSW, permission-aware retrieval with
citations), People, Products, Customers, Vendors, Projects, Documents. RLS rollout. Support
impersonation grants. Subscription migration tooling.
**Exit:** permission-aware retrieval tests (a VIEWER of company A never retrieves company B chunks).

## Phase 3 — Intelligence
Objectives/plans/milestones/tasks (persistent hierarchy), Context Engine, Planning Engine, task
decomposition, memory, retrieval, tool registry + Tool Gateway (internal tools), policy engine
(risk/budget/approval), approvals UI, evaluation, SSE execution stream, model provider abstraction
(Anthropic/OpenAI/Gemini) with routing, budgets and usage metering.
**Exit:** "Get our first 100 US customers" produces a persisted, editable plan; internal tools execute
under policy; approvals pause/resume runs; kill switch halts all runs.

## Phase 4 — Digital Workforce
Agent runtime state machine, templates for ~20 employees (CEO, Chief of Staff, Strategy, Research,
CFO, CTO, CMO, PM, Software Architect, Full-Stack Eng, QA, DevOps, SEO, Content Writer, Email
Marketing, Lead Researcher, SDR, Financial Analyst, Support Specialist, Data Analyst), per-agent
metrics. Then expand to 50–100 roles as data. Workflow engine GA.
**Exit:** agent runtime tests for limits (iterations, timeout, budget, cancellation, escalation).

## Phase 5 — External Execution
Realy Connect (OAuth, encrypted credentials, refresh, webhooks, health, revocation) + adapters
(GitHub, Vercel, Stripe, Google Workspace, Microsoft, Slack, HubSpot, Cloudflare, AWS, Meta,
LinkedIn, X, Shopify, Twilio); isolated sandbox service for browser/computer/terminal with egress
control and session recording.

## Phase 6 — Business Systems
CRM, Marketing, Sales, Finance (MRR/ARR/CAC/LTV/cash/runway from real data), Support, Analytics,
Product Studio (idea → deploy pipeline on GitHub/Vercel/Cloudflare/AWS/Sentry).

## Phase 7 — Global Platform
Marketplace, country workflows (formation, compliance calendars), additional locales, multi-region
cells (data residency routing), enterprise (SSO/SCIM, audit export), public API at `api.realy.si`
with API keys/OAuth/webhooks, developer ecosystem.

## Module extraction criteria
Extract a module into its own service only when one holds: distinct scaling profile (e.g. sandbox
execution, ingestion), distinct isolation/compliance boundary (sandboxes, regional cells), or a team
needing independent deploys. Candidates in order: sandbox execution (separate from day one),
ingestion/embedding workers, workflow engine, Realy Connect webhooks.
