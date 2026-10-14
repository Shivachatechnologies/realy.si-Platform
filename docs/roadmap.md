# Realy — Implementation Roadmap

Each phase ends only when its exit criteria are verified by automated tests, type checking, lint,
migrations and a manual UI pass (desktop + mobile, LTR + RTL). "Done" means working end-to-end.

## Phase 0 — Architecture ✅
Repository inspected (empty — greenfield). Frozen: database conventions, API conventions, event
envelope, agent protocol, tool protocol, permissions, globalization, pricing, billing, security,
design system (tokens in `src/app/globals.css`, primitives in `src/components/ui`).

## Phase 1 — Foundation (this phase)
| Module | Scope | Status |
|---|---|---|
| Tooling | Next.js 16, TS strict, Tailwind 4, Prisma 7 + pg adapter, Vitest, ESLint, Docker Compose, CI workflow | see `README.md` |
| Identity | sign-up/in/out, argon2id, DB sessions, TOTP MFA + recovery codes, OAuth provider abstraction (returns *not configured* without credentials) | |
| Tenancy | organizations, memberships, invitations, companies (independent globalization fields), workspaces, projects | |
| RBAC | permission catalog, system roles, custom roles, scoped assignments, no-escalation, MFA-gated permissions | |
| Globalization | locales (en-US, hi-IN, ar-AE, de-DE, zh-CN), RTL, formatting, countries, regions, currencies, tax configs | |
| Pricing/Billing foundation | catalog, regional prices, price versioning, entitlements, promotions/coupons, checkout quote, billing profile | |
| Admin foundation | admin console: pricing console, countries/regions, feature flags, audit log | |
| Audit + events | same-transaction audit logs + outbox; worker outbox relay | |
| Feature flags | targeting GLOBAL/REGION/COUNTRY/ORG/COMPANY/USER/PLAN | |
| Experience | Command Center shell with real (empty-state) data, navigation per spec, command palette | |

Deferred inside Phase 1 to Phase 1.1 (explicitly not claimed): Stripe Checkout session creation and
webhook processing (needs Stripe credentials; endpoint returns `not_configured`), email delivery
(provider abstraction logs in dev), OAuth login providers (abstraction only), breached-password
check, PostgreSQL RLS policies, OpenTelemetry exporter wiring, Playwright E2E in CI.

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
