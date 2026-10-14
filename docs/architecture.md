# Realy — System Architecture

> Status: **Frozen for Phase 1** (v1.0, 2026-10-14). Changes to anything marked _frozen_ require an
> Architecture Decision Record (ADR) appended to the end of this file.

Realy is a Company Operating System: infrastructure through which one founder operates an entire
company with a digital workforce. The product is the infrastructure — tenancy, the company graph,
permissions, workflows, tool execution, billing and globalization — not a chat UI.

## 1. Repository inspection (Phase 0 finding)

The repository `Shivachatechnologies/realy.si-Platform` was inspected on 2026-10-14. It contained **no
commits, no branches and no files**. There was therefore no existing framework, route, component,
database, auth, API, deployment or design system to preserve. Realy is built greenfield, and the
decisions below are made fresh rather than constrained by legacy code.

## 2. Architectural style — modular monolith + workers (_frozen_)

```
            ┌────────────────────────────── Next.js app (web) ──────────────────────────────┐
 Browser ──▶│  App Router UI (RSC)   │  Route handlers /api/v1/*   │  Server actions          │
            │                ───────────── src/server/modules/* (domain services) ──────────│
            └───────────────────────────────┬───────────────────────────────────────────────┘
                                            │ Prisma (pooled)            ▲
                                  ┌─────────▼─────────┐                  │
                                  │ PostgreSQL 16     │◀── outbox ───────┤
                                  │ + pgvector        │                  │
                                  └───────────────────┘          ┌───────┴───────────┐
                                  ┌───────────────────┐          │ Worker process(es)│
                                  │ Redis (BullMQ)    │◀────────▶│ src/worker/*      │
                                  └───────────────────┘          │ outbox relay,     │
                                                                 │ workflows, agents │
                                                                 └───────────────────┘
```

* **One deployable web app** (Next.js App Router) serving the UI and the versioned HTTP API.
* **One worker image** (same codebase, different entrypoint `src/worker/index.ts`) for every
  long-running or retryable job: outbox relay, workflow steps, agent runs, ingestion, webhooks,
  billing sync. Workers scale horizontally and independently.
* **Domain modules** live in `src/server/modules/<module>`. A module owns its tables, exposes a
  service API (plain TypeScript functions taking a `RequestContext`), and communicates with other
  modules through those service APIs or through domain events. Modules never reach into another
  module's tables directly. This keeps every module extractable into a service later.

### Why not microservices now
Realy's hardest problems (tenant isolation, permissions, transactional consistency between the
company graph, approvals and billing) are dramatically simpler in one database with one transaction
boundary. The outbox + queue boundary gives us asynchronous decoupling where we actually need it.
Extraction criteria (documented per module in `roadmap.md`): independent scaling profile,
independent deploy cadence, or isolation requirements (e.g. browser/computer sandboxes, which are
separate from day one — see `agent-runtime.md`).

## 3. Layers

| # | Layer | Where it lives | Phase |
|---|-------|----------------|-------|
| 1 | Experience | `src/app`, `src/components` | 1+ |
| 2 | Company Operating System | `modules/companies`, `organizations`, `workspaces` | 1–2 |
| 3 | Company Graph | `modules/company-graph` (relational + `graph_edges`) | 2 |
| 4 | Intelligence | `modules/intelligence` (planner, context, evaluator) | 3 |
| 5 | Digital Workforce | `modules/agents` (one runtime, many configs) | 4 |
| 6 | Workflow Engine | `modules/workflows` + worker | 3–4 |
| 7 | Tool Gateway | `modules/tools` | 3–5 |
| 8 | Permission / Policy Engine | `modules/rbac`, `modules/policy` | 1 (RBAC), 3 (risk/budget) |
| 9 | Realy Connect | `modules/integrations` | 5 |
| 10 | External Execution | `modules/execution` + isolated sandbox service | 5 |
| 11 | Data / Analytics | `modules/analytics`, events | 2–6 |
| 12 | Billing | `modules/billing`, `modules/pricing` | 1 |
| 13 | Globalization | `modules/globalization`, `src/i18n` | 1 |
| 14 | Security | cross-cutting (`src/server/core/security`) | 1+ |
| 15 | Administration | `modules/admin`, `src/app/(admin)` | 1+ |

### Request path (every mutation)
```
HTTP / server action
  → authenticate (session or API key)          core/auth
  → resolve tenant (org/company/workspace)     modules/organizations
  → authorize (RBAC: permission @ scope)       modules/rbac
  → validate input (Zod)                       module schema
  → policy (risk / budget / approval)          modules/policy   (Phase 3)
  → domain service (in a DB transaction)
      → write rows
      → write audit_log row(s)                 modules/audit
      → write outbox event(s)                  modules/events
  → commit → response with requestId
worker: outbox relay → BullMQ → subscribers
```
Audit and events are written **in the same transaction** as the change they describe, so there is
never a change without its audit record or an event for a change that rolled back.

### Agent action path (Phase 3+)
```
Objective → Plan → Task → Agent runtime (worker)
  → Tool Gateway: tool.request(name, input)
      → validate input schema → RBAC for the agent principal → resource scope
      → risk policy (autonomy level) → budget policy → approval (if required; run pauses)
      → Realy Connect: obtain short-lived credential for provider (agent never sees secrets)
      → provider adapter executes → validate output schema → audit + event
  → observe → verify → next step | complete | escalate
```
The model is never the security boundary: every check above is server-side code that runs
regardless of what the model asked for.

## 4. Technology (_frozen_)

| Concern | Choice | Notes |
|---|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript strict | RSC by default; client components only for interactivity |
| Styling | Tailwind CSS 4, shadcn/ui-style primitives on Radix | logical properties only (RTL) |
| Data fetching (client) | TanStack Query; TanStack Table for grids | |
| Forms | React Hook Form + Zod | same Zod schema validates server-side |
| ORM / DB | Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 16, pgvector | |
| Queue | BullMQ on Redis | durable jobs, retries, backoff, rate limits |
| Object storage | S3-compatible (AWS S3 / R2 / MinIO locally) | |
| Auth | First-party: argon2id passwords, opaque DB sessions, TOTP MFA, OAuth via provider abstraction, SAML/OIDC SSO architecture | see `security.md` |
| AI | Provider abstraction: Anthropic Claude, OpenAI, Google Gemini | see `agent-runtime.md` |
| Payments | Stripe (Billing + Tax) | internal pricing catalog is source of truth, synced to Stripe |
| Observability | OpenTelemetry, Sentry, structured JSON logs (pino), health endpoints | |
| Product analytics | PostHog (abstracted) | |
| Email | Provider abstraction (Resend / SES / Postmark) | |
| Tests | Vitest (unit + DB integration), Playwright (E2E), k6 (load) | |

## 5. Code layout (_frozen_)

```
docs/                     architecture docs (this folder)
prisma/schema.prisma      single source of truth for the relational model
prisma/migrations/        SQL migrations (committed, applied by CI/CD)
prisma/seed.ts            reference data (countries, regions, currencies, languages, permissions, roles)
src/app/                  Next.js routes: (auth), (app), (admin), api/v1
src/components/           UI primitives (ui/) and composite components
src/i18n/                 locale config, message catalogs (messages/<locale>.json), formatting
src/server/core/          db, errors, request context, logging, crypto, http helpers
src/server/modules/<m>/   domain modules: service.ts, schemas.ts, (repository.ts), index.ts
src/worker/               worker entrypoint and job processors
tests/                    unit/, integration/ (real Postgres), e2e/
```

## 6. Multi-tenancy (_frozen_)

Hierarchy: `User → (Membership) → Organization → Company → Workspace → Projects/Products/Systems`.

* **Organization** is the billing and security tenant. Every tenant-owned row carries
  `organization_id`; company-scoped rows also carry `company_id`. Both are indexed (leading column of
  composite indexes) so tenant-filtered queries are always index-driven.
* **Isolation is enforced in three places**: (1) the service layer only accepts a `RequestContext`
  whose tenant was resolved from an authenticated membership — never from a client-supplied id alone;
  (2) every query in tenant modules filters by `organization_id` (enforced by a repository helper
  and verified by tenant-isolation tests); (3) PostgreSQL Row-Level Security policies keyed on
  `current_setting('realy.org_id')` as defense-in-depth (rolled out per table in Phase 2; see
  `security.md`).
* A user may belong to many organizations; principals may also be **service accounts** and **AI
  identities (agents)**, each a first-class principal with its own role assignments.

## 7. Globalization is structural, not cosmetic

The independent dimensions — user locale, user country, company country (incorporation), billing
country, operating countries, target markets, timezone, data region — are **separate columns**.
Nothing infers one from another except as an overridable default. See `globalization.md`.

## 8. Scalability posture

Designed for millions of organizations: UUIDv7-style time-ordered keys, tenant-leading composite
indexes, cursor pagination on every list API, no unbounded queries, all long work in queues, idempotency
keys on mutating APIs, connection pooling (PgBouncer / Prisma Accelerate-compatible), read replicas for
analytics, partitioning plan for `events`, `audit_logs`, `usage_records` (monthly range partitions),
and data-region–aware routing (`company.data_region`) so a regional database cell can be introduced
without schema change.

## 9. "No fake features" rule

The UI must never imply a capability that does not exist. Unimplemented integrations render
"Not connected"; metrics with no data render an empty state, never placeholder numbers. Agents that
cannot perform an action report the limitation. Seed data contains only reference data (countries,
currencies, permissions) and, in development only, an explicitly-labelled demo admin.

## ADR log

* **ADR-001 (2026-10-14)** Greenfield, modular monolith + workers. Rationale above.
* **ADR-002 (2026-10-14)** First-party auth instead of a hosted IdP, so that agent and service-account
  principals share one identity/permission model with humans. Enterprise SSO is added as an
  authentication method (SAML/OIDC) feeding the same session model.
* **ADR-003 (2026-10-14)** Money stored as `BigInt` minor units + ISO-4217 code; never floats.
* **ADR-004 (2026-10-14)** Internal pricing catalog is the source of truth; Stripe Prices are created
  from immutable `price_versions` and referenced by id.
