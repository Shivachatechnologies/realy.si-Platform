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

### Platform (optional) — two apps, see [architecture/apps.md](architecture/apps.md)

`ADMIN_URL` (user app), `USER_APP_URL` (admin app), `REALY_BOOTSTRAP_ADMIN_EMAIL`, `TRUSTED_PROXY_HOPS` (Vercel: `1`),
`SKIP_DB_MIGRATIONS`, `RUN_DB_MIGRATIONS`, `LOG_LEVEL`, `APP_VERSION` / `GIT_SHA` (shown in worker heartbeats).

### AI, email, billing, observability (optional, both services)

`ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_ALLOWED_MODELS`, `AI_DAILY_TOKEN_LIMIT`,
`EMAIL_PROVIDER` (`resend`, `postmark` or `smtp`), `EMAIL_API_KEY` (Resend / Postmark), `EMAIL_FROM`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` (with `EMAIL_PROVIDER=smtp`, see
[Email through Google Workspace](#email-through-google-workspace-smtp)),
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (web), `STRIPE_AUTOMATIC_TAX`,
`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

### Email through Google Workspace (SMTP)

Transactional email (password resets, invitations, notifications) can go through Google Workspace instead of Resend or
Postmark. Every value can be set in the Control Center → **Platform keys** → Email (write-only for the password) or in
the hosting environment; the worker reads them through the same platform-keys overlay (~30 s refresh). Use the
**Test** button on `SMTP_HOST` or `SMTP_PASSWORD`: it connects, negotiates TLS and authenticates without sending.

**Option A — a mailbox with an App Password (smtp.gmail.com).**

1. Create (or pick) a mailbox such as `no-reply@yourdomain.com`. Turn on 2-Step Verification for it.
2. Google Account → Security → 2-Step Verification → **App passwords** → create one ("Realy"). (App Passwords are only
   offered once 2-Step Verification is on; some Workspace security policies hide them.)
3. Set:

   | Key | Value |
   |---|---|
   | `EMAIL_PROVIDER` | `smtp` |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS) |
   | `SMTP_SECURE` | empty (derived from the port: 465 → TLS, otherwise STARTTLS) or `true` / `false` |
   | `SMTP_USER` | the mailbox address |
   | `SMTP_PASSWORD` | the App Password (the spaces Google shows are ignored) |
   | `EMAIL_FROM` | `Realy <no-reply@yourdomain.com>` |

   Gmail only sends **as the authenticated user or a verified "Send mail as" alias**. With any other `EMAIL_FROM`
   Gmail silently replaces the sender; the Test result warns when `EMAIL_FROM` is not `SMTP_USER`, and a refused
   sender surfaces as "The SMTP server refused the From address…". Gmail sending limits apply (about 2,000 messages a
   day per Workspace user).

**Option B — the Workspace SMTP relay (smtp-relay.gmail.com).** Admin console → Apps → Google Workspace → Gmail →
Routing → **SMTP relay service**: allow "Only addresses in my domains", require TLS, and choose either SMTP
authentication (then set `SMTP_USER` / `SMTP_PASSWORD` as above) or the sending servers' IP addresses (leave both
empty; Vercel has no fixed egress IPs, so use authentication there). `SMTP_HOST=smtp-relay.gmail.com`, port `587`
(or `465` / `25`). The From domain must be one of your Workspace domains.

STARTTLS is mandatory on non-TLS ports (connections that cannot upgrade are refused); certificates are verified.
Resend and Postmark keep working unchanged: switch back by setting `EMAIL_PROVIDER` to `resend` or `postmark`.

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
`CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `ZENDESK_CLIENT_ID`, `ZENDESK_CLIENT_SECRET`, `INTERCOM_CLIENT_ID`,
`INTERCOM_CLIENT_SECRET`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`,
`WEBFLOW_CLIENT_ID`, `WEBFLOW_CLIENT_SECRET`, `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`,
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
| `WORKER_DRAIN_DELAY_S` | 60 | Seconds an idle BullMQ worker blocks on its empty queue before polling again (BullMQ default 5). A new job wakes it at once, so this only sets the idle Redis rate, not job latency. See §4 "Redis command budget". |
| `WORKER_STALLED_INTERVAL_MS` | 120000 | How often each worker checks its queue for stalled jobs (BullMQ default 30000). A job whose worker died is recovered within its lock duration + this. |
| `WORKER_MAX_STALLED_COUNT` | 1 | Recoveries from a stall before a job fails. |
| `WORKER_SCHEDULE_TICK_MS` | 15000 | How often each replica claims due recurring jobs (one Redis script call). Also the schedule resolution: a recurring job starts at most this late. |
| `WORKER_HEARTBEAT_MS` | 60000 | Heartbeat interval (Postgres row + Redis key); a worker counts as alive for 3 minutes. Max 90000. |
| `WORKER_RELAY_IDLE_MAX_MS` | 2000 | Longest pause of an idle outbox relay between database polls (it backs off from 500 ms when there is nothing to relay and returns to 500 ms as soon as events come). No Redis involved. |
| `REALY_SERVICE` | `web` | Log field; set `worker` on the worker. |

## 3. Web on Vercel

| Setting | Value |
|---------|-------|
| Framework preset | Next.js |
| Node.js version | 22.x |
| Install command | `pnpm install --frozen-lockfile` |
| Root directory | `apps/user` (user app) · `apps/admin` (Control Center, second project — see [architecture/apps.md](architecture/apps.md)) |
| Build command | `pnpm run build` from `vercel.json` (user: `prisma generate` → `scripts/deploy-db.mjs` → `next build`; admin: no migrations). On Vercel (`VERCEL=1`) the build applies pending migrations (`prisma migrate deploy`, using `DIRECT_DATABASE_URL`) and the idempotent reference-data seed. `SKIP_DB_MIGRATIONS=true` builds without touching the database. |
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
* Key prefixes: `realy:*` (queues, recurring-job state `realy:schedule-state`, schedule locks, heartbeats), `bull:events:*` (domain events), `rl:*` (rate limits).
  Use a separate Redis (or database index) per environment.
* Serverless Redis products that do not support blocking commands and Lua scripts are not suitable for BullMQ.

### Redis command budget

Per-command billing (Upstash and similar) charges the worker even when nobody uses the platform: BullMQ workers poll
their queues and run Lua scripts, and a script is billed by the commands it runs. Upstash's **free tier (500 000
commands) is not suitable** for the worker, even after the tuning below (≈ 3.5 M commands a month idle for one
replica): use pay-as-you-go or a fixed plan, or a Redis billed by memory/instance (Render Key Value, Redis Cloud,
ElastiCache), which suits BullMQ better.

Idle commands per minute and worker replica (counting the commands inside Lua scripts; measured with
`redis-cli INFO commandstats`):

```
idle/min ≈ W × 8 × 60 / D          blocking poll: BZPOPMIN + moveToActive script (~6 commands) per D seconds
         + W × 7 × 60 000 / S      stalled-job check script per S ms
         + 3 × 60 000 / T + ~5     recurring-job claim script per T ms (+ extra claims when many jobs are due at once)
         + 60 000 / H              heartbeat key per H ms
W = BullMQ workers in the replica (6 with WORKER_ROLES=all: agent-tasks, auth-email, events, module-jobs,
    webhooks, schedules), D = WORKER_DRAIN_DELAY_S (a queue holding delayed jobs, e.g. retries waiting for their
    backoff, wakes at least every 10 s: use D = 10 for it), S = WORKER_STALLED_INTERVAL_MS,
    T = WORKER_SCHEDULE_TICK_MS, H = WORKER_HEARTBEAT_MS
per month ≈ idle/min × 43 200, plus the work itself (roughly 50 commands per processed job, ~10 per relayed event
batch, 1 per rate-limited web request; the web app's readiness check pings Redis at most every 15 s per instance).
```

Defaults: 6 × 8 + 6 × 3.5 + 12 + 5 + 1 ≈ **85 commands/min ≈ 3.7 M/month** per idle replica.

Measured idle (all roles, empty queues, local Redis 7, 3-minute window after start-up):

| | commands / 3 min | / min | / month (× 43 200) |
|---|---|---|---|
| Before (BullMQ defaults: drainDelay 5 s, stalled check 30 s; 77 BullMQ job schedulers, ~31 ticks/min at ~55 commands each) | 6 860 | 2 287 | ≈ 99 M |
| After (defaults above, periodic runner) | 243 | 81 | ≈ 3.5 M |

Before, ~75 % of the idle traffic was recurring-job ticks (each a full BullMQ job), ~22 % idle polling with a 5 s
drain delay. Recurring jobs now run in-process: one script call per tick claims the due ones (§5). Job pickup is
unchanged — an idle worker's BZPOPMIN returns the moment a job is added (measured: 1–22 ms from enqueue to start;
outbox event to fan-out job ≤ 1.6 s with the idle relay back-off).

## 5. Worker service

**Command:** `node_modules/.bin/tsx src/worker/index.ts` (in the image's `worker` target, working directory `/app/packages/backend`) · `pnpm worker` (locally).
**Image:** `docker build -f deploy/worker/Dockerfile .` (worker-only image, no Next build). The root Dockerfile's `--target worker` also works but builds the web app first.
**Ready-made configs:** `deploy/worker/render.yaml` (Render Blueprint: worker only; uses the web app's Redis via `REDIS_URL`), `deploy/worker/fly.toml`
(Fly.io), `deploy/worker/worker.env.example` (variable names), `docker-compose.yml` profile `app` (local full stack).

**Running server modules outside Next.** The worker loads the same `src/server/**` modules as the web apps, many of
which start with `import "server-only"`. Next resolves that marker to an empty module (`react-server` condition);
plain Node takes the package's default entry, which throws. `src/worker/index.ts` therefore imports
`src/worker/preload.ts` **first**: it redirects `server-only` to the package's empty module (a CommonJS
`Module._resolveFilename` wrapper — tsx runs this package as CommonJS — plus `module.registerHooks` for ESM imports on
Node ≥ 22.15) and points the app-provided `@/i18n/server` at `src/worker/i18n-server.ts` (user catalogs;
`DEFAULT_LOCALE` when a job passes no locale). The web apps never import the preload, so Next behaviour is unchanged.
Keep `import "./preload"` the first import of the worker entry; any other tsx entry that loads server modules must
import it first too.

What it runs:

| Queue | Producer | Work | Retries (exponential backoff) |
|-------|----------|------|-------------------------------|
| `agent-tasks` | web | AI task executions | 3 × from 5 s; final failure marks the task FAILED |
| `auth-email` | web | password-reset email | 5 × from 2 s; data deleted after 24 h, never dead-lettered |
| `events` | outbox relay (worker) | fan-out of each domain event to one `module-jobs` job per handler | 10 × from 1 s |
| `module-jobs` | worker | event handlers (automation engine, notifications, outbound webhooks…), integration syncs and connection health checks | 5 × from 5 s (syncs 2) |
| `schedules` | periodic runner (worker), admins requeuing | every module's recurring job (recurring invoices, scheduled posts, workflow and AI schedules, campaigns, syncs, maintenance…). Each replica's periodic runner (`src/worker/schedules.ts`) claims due jobs every `WORKER_SCHEDULE_TICK_MS` through one Redis hash (`realy:schedule-state`: per job the last finished slot and a lease) and runs them in-process — one run per slot across all replicas, never overlapping (the lease is renewed while a run lasts; a run lost with its replica is claimed again by another once the lease lapses, ≤ 2 min). The BullMQ queue only runs dead-lettered runs requeued by an administrator. | 3 × from 15 s (in-process), then dead-lettered |
| `webhooks` | worker | outbound webhook deliveries (signed; HTTP failures follow the delivery's own 1 min…6 h schedule) | 3 × from 10 s |
| `dead-letter` | worker | copies of jobs whose last attempt failed (kept 30 days) | – |

* **Job history:** every attempt is persisted in `worker_job_runs` (status, attempts, timings, secret-free error, a
  short execution log — never payloads). Recurring ticks are stored only when they did work or failed.
* **Dead-letter queue:** Admin → System → Background jobs (`/{locale}/admin/system/jobs`) lists dead-lettered jobs;
  requeue or discard with a reason (audited). API: `GET /api/v1/admin/jobs?view=overview`,
  `GET /api/v1/admin/jobs?status=DEAD`, `GET /api/v1/admin/jobs/{runId}`,
  `POST /api/v1/admin/jobs/{runId}/requeue|discard` `{ "reason": "…" }` (read: `platform.security.read`,
  `platform.organizations.read` or `platform.controls.manage`; actions: `platform.controls.manage`).
* **Heartbeat:** every `WORKER_HEARTBEAT_MS` (60 s) a `platform_heartbeats` row and an expiring Redis key. A worker is alive when its heartbeat is
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
   `node_modules/.bin/prisma migrate deploy` in `/app/packages/database` (then `node_modules/.bin/tsx prisma/seed.ts` with `SEED_DEV_CATALOG=false`).
   Migrations are additive, so old web/worker versions keep working while the new ones roll out.
3. Deploy the web app, then roll the worker (rolling restart; each replica drains on SIGTERM).
4. Verify: `GET /api/health/ready` → `status: "ready"`, `checks.worker: "ok"`; Admin → System → Background jobs shows the
   new worker heartbeat and an empty dead-letter queue.

## 7. Scaling

* **Web:** automatic on Vercel. Use a pooled `DATABASE_URL` (PgBouncer/Prisma Accelerate) sized for concurrent functions.
* **Worker:** scale replicas horizontally — every queue is safe to consume from many replicas, each recurring-job slot
  runs once (claimed atomically through Redis), and the outbox relay claims rows with `SKIP LOCKED`. Each replica adds
  its own idle Redis commands (§4 "Redis command budget"): prefer fewer replicas, and give dedicated pools only the
  roles they need (`WORKER_ROLES`), which also lowers `W`. Start with one replica (2 vCPU / 1 GB). Raise
  `WORKER_AI_CONCURRENCY` with your AI provider limits; split heavy AI load into a dedicated pool with
  `WORKER_ROLES=agents` and run the rest with `WORKER_ROLES=relay,events,modules,schedules,webhooks,email`.
* **Database connections:** each worker replica holds one Prisma pool plus one Redis connection per queue; budget
  `replicas × (pool size)` connections.
* **Provider limits:** outbound provider calls are throttled per connection (`src/server/modules/integrations/client.ts`,
  `PROVIDER_RATE_LIMITS`), retried with backoff on 429/5xx and failed over to the next connected provider where a
  fallback chain exists, so scaling workers does not multiply provider rate-limit errors.
