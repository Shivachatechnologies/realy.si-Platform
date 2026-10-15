# Realy

**Intelligence infrastructure for companies.** One founder. One platform. An entire company.

Realy is a Company Operating System: tenancy, a company graph, permissions, workflows, tool execution,
billing and globalization that a digital workforce operates on. This repository is the modular
monolith (Next.js web app + worker) described in [`docs/architecture.md`](docs/architecture.md).

**Status:** Phase 0 (architecture) and Phase 1 (foundation) are implemented — see
[`docs/roadmap.md`](docs/roadmap.md) for exactly what is done, what is Phase 1.1, and what comes next.
Modules from later phases appear in navigation with an explicit "Phase N" state; nothing is simulated.

## Architecture docs

| | |
|---|---|
| [architecture](docs/architecture.md) | layers, modular monolith, request path, tenancy, ADRs |
| [database](docs/database.md) | conventions, Phase 1 schema, later-phase tables |
| [api](docs/api.md) | conventions, error envelope, implemented endpoints |
| [security](docs/security.md) | threat model, auth, data protection, AI security |
| [rbac](docs/rbac.md) | permissions, roles, scopes, no-escalation |
| [globalization](docs/globalization.md) | independent country dimensions, i18n, RTL, currencies |
| [billing](docs/billing.md) | pricing engine, versioning, regional checkout |
| [agent-runtime](docs/agent-runtime.md) · [tool-system](docs/tool-system.md) · [integrations](docs/integrations.md) · [workflows](docs/workflows.md) | Phase 3–5 contracts |
| [roadmap](docs/roadmap.md) | phases and status |

## Local development

Requirements: Node 22, pnpm 10, PostgreSQL 16 with pgvector, Redis 7 (`docker compose up -d` provides both).

```bash
cp .env.example .env            # then set REALY_ENCRYPTION_KEY=$(openssl rand -base64 32)
pnpm install
pnpm db:migrate                 # apply migrations
pnpm db:seed                    # reference data (+ illustrative dev pricing catalog outside production)
pnpm dev                        # web app on http://localhost:3000
pnpm worker                     # worker: outbox relay + password-reset email queue (required)
```

Create the first platform administrator (there is deliberately no UI path to this):

```bash
pnpm realy:grant-role you@example.com SUPER_ADMIN
pnpm realy:grant-role uae-ops@example.com REGION_ADMIN REGION MIDDLE_EAST
```

Administrative changes (pricing, flags, countries, role grants) require two-factor authentication —
enable it under **Settings → Security**.

### Optional services

Stripe billing, email delivery (Resend or Postmark), OAuth login (Google, GitHub, Microsoft), Sentry
and OpenTelemetry are each enabled by setting their variables in `.env` (see `.env.example` for
names, webhook and redirect URLs). Until then the product says so — "Billing is not configured.",
"OAuth provider not configured.", invitation delivery "Email not configured" — instead of simulating
success. **Admin → System** shows which services are configured (booleans only, never values).
`TRUSTED_PROXY_HOPS` is required in production (the app refuses to start without it): set it to
the number of proxies in front of the app that append to `X-Forwarded-For`, or rate limits will key
on the wrong address. Run the app behind at least one such proxy.

## Quality gates

```bash
pnpm typecheck      # route types + tsc
pnpm lint
pnpm test           # unit + integration against a real *_test PostgreSQL database (TEST_DATABASE_URL)
pnpm build
pnpm test:e2e       # Playwright founder journey against a running app (pnpm start + pnpm worker)
```

Tests refuse to touch anything but a disposable local database (`tests/db-guard.ts`): integration
tests require a name ending in `_test`, E2E (`DATABASE_URL` must be set, same as the app under test)
`_e2e` or `_test`, both on `localhost` unless `ALLOW_REMOTE_TEST_DATABASE=1` is set for a dedicated
disposable server. E2E expects a freshly migrated and seeded database. CI (`.github/workflows/ci.yml`)
runs all of the above.

## Repository layout

```
docs/                     architecture (frozen contracts + ADRs)
prisma/                   schema, migrations (with DB-level invariants), seed
src/app/[locale]/         UI (App Router, locale-prefixed, RTL-aware)
src/app/api/              versioned HTTP API (/api/v1) and health checks
src/server/core/          db, env, errors, crypto, http conventions, logging, pagination
src/server/modules/       domain modules: auth, organizations, companies, rbac, pricing, billing,
                          globalization, flags, audit, events
src/worker/               worker entrypoint (outbox relay; workflows/agents in later phases)
src/i18n/                 locale config, ICU message catalogs, Intl formatting
tests/                    unit, integration (real Postgres), e2e (Playwright)
```
