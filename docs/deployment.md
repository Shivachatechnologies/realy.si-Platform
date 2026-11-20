# Deployment

> Production requirements for Realy: one **web** service (Next.js, Vercel), one or more **worker** services (BullMQ,
> long-running container), managed **PostgreSQL 16 + pgvector** and managed **Redis 7**. Same codebase and image for web
> and worker (docs/architecture.md §2). This document names environment variables only — never commit values.

## 1. Topology

```
            HTTPS                         outbox (events table)
Browser ───────────▶ Web (Vercel) ─────────────────────────────┐
                       │  enqueue (AI tasks, password reset)   │
                       ▼                                       ▼
                    Redis 7 (BullMQ) ◀──────────────▶ Worker service(s)  ──▶ providers (AI, email, webhooks, APIs)
                       ▲                                       │
                       └──────── PostgreSQL 16 + pgvector ◀────┘  (job runs, heartbeats, all business data)
```

| Component  | Required | Notes |
|------------|----------|-------|
| PostgreSQL 16 with `pgvector` | yes | Pooled URL for the app (`DATABASE_URL`), direct URL for migrations (`DIRECT_DATABASE_URL`). |
| Redis 7    | yes for background work | Durable (AOF/managed persistence), **`maxmemory-policy noeviction`**, TLS (`rediss://`). One instance shared by web and worker. |
| Web        | yes | Vercel (Next.js 16). Stateless, scales automatically. |
| Worker     | yes for background work | Long-running Node 22 container (Render, Fly.io, ECS, Kubernetes…). Not serverless. |

## 2. Environment variables

Set the **same values on web and worker** unless the column says otherwise. Every optional feature reports
"not configured" in the product when its variables are absent — nothing pretends to work.

### Core (required)

| Variable | Web | Worker | Purpose |
|----------|-----|--------|---------|
| `DATABASE_URL` | ✓ | ✓ | PostgreSQL connection (pooled). |
| `DIRECT_DATABASE_URL` | build | – | Non-pooled URL used by `prisma migrate deploy` during the Vercel build. |
| `REDIS_URL` | ✓ | ✓ | BullMQ queues, rate limits. Optional for the web app (falls back to Postgres rate limits; background work then reports "worker not configured"); **required by the worker**. |
| `REALY_ENCRYPTION_KEY` | ✓ | ✓ | 32 random bytes, base64. Encrypts integration credentials, webhook secrets, OAuth state. Identical on all services; rotating it makes stored credentials unreadable. |
| `APP_URL` | ✓ | ✓ | Public base URL (OAuth redirect URIs, webhook URLs, email links). |
| `NODE_ENV` | ✓ | ✓ | `production`. |

### Platform / surfaces (optional)

`APP_SURFACE`, `ADMIN_URL`, `USER_APP_URL`, `REALY_BOOTSTRAP_ADMIN_EMAIL`, `TRUSTED_PROXY_HOPS` (Vercel: `1`),
`SKIP_DB_MIGRATIONS`, `RUN_DB_MIGRATIONS`, `LOG_LEVEL`, `APP_VERSION` / `GIT_SHA` (shown in worker heartbeats).

### AI, email, billing, observability (optional, both services)

`ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_ALLOWED_MODELS`, `AI_DAILY_TOKEN_LIMIT`,
`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (web), `STRIPE_AUTOMATIC_TAX`,
`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

### Sign-in and integration OAuth apps (optional, both services)

The worker needs them too: it refreshes OAuth tokens during scheduled syncs and health checks.

`OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET` (also YouTube, Search Console, Google Ads),
`OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`,
`OAUTH_MICROSOFT_CLIENT_ID`, `OAUTH_MICROSOFT_CLIENT_SECRET`, `OAUTH_MICROSOFT_TENANT`,
`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`,
`SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_LOGIN_URL`,
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (also LinkedIn Ads), `X_CLIENT_ID`, `X_CLIENT_SECRET`,
`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (also Instagram, Meta Ads), `THREADS_APP_ID`, `THREADS_APP_SECRET`,
`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ADS_APP_ID`, `TIKTOK_ADS_APP_SECRET`,
`PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET`, `MAILCHIMP_CLIENT_ID`, `MAILCHIMP_CLIENT_SECRET`,
`QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_ENVIRONMENT`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`,
`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_API_VERSION`.

Redirect URI to register with each provider: `{APP_URL}/api/v1/integrations/oauth/{provider}/callback`.
API-key providers (OpenAI, Gemini, Tavily, Stripe, Twilio, S3…) need no platform variables: each company enters its own
keys under Integrations; they are verified with the provider before the connection is saved and encrypted at rest.

### Worker tuning (optional, worker only)

| Variable | Default | Meaning |
|----------|---------|---------|
| `WORKER_ROLES` | `all` | Comma list of `relay, agents, events, modules, schedules, webhooks, email`. Every role must run in at least one replica. |
| `WORKER_AI_CONCURRENCY` | 2 | Parallel AI task executions per replica. |
| `WORKER_EVENTS_CONCURRENCY` | 4 | Parallel domain-event fan-outs. |
| `WORKER_MODULE_CONCURRENCY` | 4 | Parallel event-handler runs and module tasks (syncs, health checks). |
| `WORKER_SCHEDULE_CONCURRENCY` | 4 | Parallel recurring jobs. |
| `WORKER_WEBHOOK_CONCURRENCY` | 8 | Parallel outbound webhook deliveries. |
| `WORKER_EMAIL_CONCURRENCY` | 5 | Parallel password-reset emails. |
| `WORKER_AI_LOCK_MS` | 60000 | Lock duration of AI jobs (renewed while running). |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 25000 | Graceful drain on SIGTERM; keep below the platform's kill timeout. |
| `REALY_SERVICE` | `web` | Log field; set `worker` on the worker. |

## 3. Web on Vercel

| Setting | Value |
|---------|-------|
| Framework preset | Next.js |
| Node.js version | 22.x |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` (= `prisma generate` → `scripts/deploy-db.mjs` → `next build`). On Vercel (`VERCEL=1`) the build applies pending migrations (`prisma migrate deploy`, using `DIRECT_DATABASE_URL`) and the idempotent reference-data seed. `SKIP_DB_MIGRATIONS=true` builds without touching the database. |
| Output | default (`.next`) |
| Function region | the region of the database and Redis |
| Environment variables | §2, for Production and Preview (Preview should use its own database and Redis) |
| Health checks | liveness `GET /api/health` · readiness `GET /api/health/ready` |
| Cron jobs | **none**. All schedules run on the worker (§5); Vercel Cron is not used. |

`/api/health/ready` returns 200 when database, migrations and seed are in place, 503 otherwise. `checks.redis` and
`checks.worker` (`ok` · `stale` · `missing` · `not_configured`) only degrade the status to `degraded`; the response's
`worker.message` reads `"worker not configured"` when `REDIS_URL` is unset in production.

## 4. Redis

* Managed Redis 7 with persistence, TLS and **`noeviction`** (BullMQ data must never be evicted). Size: a few hundred MB
  is plenty; completed jobs are trimmed automatically (bounded `removeOnComplete` / `removeOnFail`).
* Key prefixes: `realy:*` (queues, schedule locks, heartbeats), `bull:events:*` (domain events), `rl:*` (rate limits).
  Use a separate Redis (or database index) per environment.
* Serverless Redis products that do not support blocking commands and Lua scripts are not suitable for BullMQ.

## 5. Worker service

**Command:** `node_modules/.bin/tsx src/worker/index.ts` (in the image) · `pnpm worker` (locally).
**Image:** `docker build --target worker .` (or the default image with the command override).
**Ready-made configs:** `deploy/worker/render.yaml` (Render Blueprint: worker + Redis), `deploy/worker/fly.toml`
(Fly.io), `deploy/worker/worker.env.example` (variable names), `docker-compose.yml` profile `app` (local full stack).

What it runs:

| Queue | Producer | Work | Retries (exponential backoff) |
|-------|----------|------|-------------------------------|
| `agent-tasks` | web | AI task executions | 3 × from 5 s; final failure marks the task FAILED |
| `auth-email` | web | password-reset email | 5 × from 2 s; data deleted after 24 h, never dead-lettered |
| `events` | outbox relay (worker) | fan-out of each domain event to one `module-jobs` job per handler | 10 × from 1 s |
| `module-jobs` | worker | event handlers (automation engine, notifications, outbound webhooks…), integration syncs and connection health checks | 5 × from 5 s (syncs 2) |
| `schedules` | BullMQ job schedulers | every module's recurring job (recurring invoices, scheduled posts, workflow and AI schedules, campaigns, syncs, maintenance…) — one run per tick across all replicas, Redis lock against overlap | 3 × from 15 s |
| `webhooks` | worker | outbound webhook deliveries (signed; HTTP failures follow the delivery's own 1 min…6 h schedule) | 3 × from 10 s |
| `dead-letter` | worker | copies of jobs whose last attempt failed (kept 30 days) | – |

* **Job history:** every attempt is persisted in `worker_job_runs` (status, attempts, timings, secret-free error, a
  short execution log — never payloads). Recurring ticks are stored only when they did work or failed.
* **Dead-letter queue:** Admin → System → Background jobs (`/{locale}/admin/system/jobs`) lists dead-lettered jobs;
  requeue or discard with a reason (audited). API: `GET /api/v1/admin/jobs?view=overview`,
  `GET /api/v1/admin/jobs?status=DEAD`, `GET /api/v1/admin/jobs/{runId}`,
  `POST /api/v1/admin/jobs/{runId}/requeue|discard` `{ "reason": "…" }` (read: `platform.security.read`,
  `platform.organizations.read` or `platform.controls.manage`; actions: `platform.controls.manage`).
* **Heartbeat:** every 30 s a `platform_heartbeats` row and an expiring Redis key. A worker is alive when its heartbeat is
  younger than 3 minutes; shown in Admin → System and in `/api/health/ready`.
* **Platform controls:** "pause background jobs" pauses event, module and webhook processing and skips recurring
  jobs; "pause AI execution" pauses `agent-tasks`; "automations off" skips automation handlers and schedules.
* **Graceful shutdown:** on SIGTERM the worker stops fetching jobs, waits up to `WORKER_SHUTDOWN_TIMEOUT_MS` for running
  ones, then closes (jobs still running are recovered by BullMQ's stalled-job check on another replica). A second
  signal exits immediately. Give the platform a kill timeout longer than the drain (Render `maxShutdownDelaySeconds`,
  Fly `kill_timeout`, Kubernetes `terminationGracePeriodSeconds`).
* **No HTTP port.** Do not configure an HTTP health check on the worker; monitor the heartbeat instead (alert when
  `/api/health/ready` reports `checks.worker` ≠ `ok`).

### Without Redis

If `REDIS_URL` is not set in production the web app still serves every page: rate limits use Postgres, manual actions
(test connection, sync now, redeliver a webhook) run inline, and the product says "worker not configured" (readiness
check, Integrations, Admin → System). AI tasks cannot be queued (they fail fast with `queue_unavailable` instead of
looking queued), and recurring jobs, scheduled syncs, webhook retries and health checks do not run. The worker refuses
to start without `REDIS_URL`.

## 6. Release procedure

1. Build and push the image (or let Vercel build the web app).
2. Apply migrations once: on Vercel this happens in the build; elsewhere run
   `node_modules/.bin/prisma migrate deploy` (then `node_modules/.bin/tsx prisma/seed.ts` with `SEED_DEV_CATALOG=false`).
   Migrations are additive, so old web/worker versions keep working while the new ones roll out.
3. Deploy the web app, then roll the worker (rolling restart; each replica drains on SIGTERM).
4. Verify: `GET /api/health/ready` → `status: "ready"`, `checks.worker: "ok"`; Admin → System → Background jobs shows the
   new worker heartbeat and an empty dead-letter queue.

## 7. Scaling

* **Web:** automatic on Vercel. Use a pooled `DATABASE_URL` (PgBouncer/Prisma Accelerate) sized for concurrent functions.
* **Worker:** scale replicas horizontally — every queue is safe to consume from many replicas, schedulers run each tick
  once, and the outbox relay claims rows with `SKIP LOCKED`. Start with one replica (2 vCPU / 1 GB). Raise
  `WORKER_AI_CONCURRENCY` with your AI provider limits; split heavy AI load into a dedicated pool with
  `WORKER_ROLES=agents` and run the rest with `WORKER_ROLES=relay,events,modules,schedules,webhooks,email`.
* **Database connections:** each worker replica holds one Prisma pool plus one Redis connection per queue; budget
  `replicas × (pool size)` connections.
* **Provider limits:** outbound provider calls are throttled per connection (`src/server/modules/integrations/client.ts`,
  `PROVIDER_RATE_LIMITS`), retried with backoff on 429/5xx and failed over to the next connected provider where a
  fallback chain exists, so scaling workers does not multiply provider rate-limit errors.
