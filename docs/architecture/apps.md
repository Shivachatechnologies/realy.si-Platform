# Two apps, shared backend: `apps/user` and `apps/admin`

Realy ships as **two independent Next.js applications** in one pnpm monorepo, on top of shared backend packages.
The split was produced by `scripts/split/run.mjs` (see [Re-running the transformation](#re-running-the-transformation)).

| Domain | App | What it serves |
|---|---|---|
| `app.realy.si` | `apps/user` (`@realy/user`) | founder product: `(app)` routes, user sign-in/up/MFA/recovery, public site (`/[locale]`, pricing, blog, help, careers, changelog, `p`, `f`, `i`, `t`, support-form, unsubscribe), `/unavailable`, the whole user API `/api/v1/**` (except admin), public API, webhooks, health |
| `admin.realy.si` | `apps/admin` (`@realy/admin`) | Control Center only: console pages at `/[locale]/…` (formerly `/[locale]/admin/…`), its own login (`/[locale]/login`) and MFA step, `/api/v1/admin/**`, plus the few endpoints it needs (`/api/v1/auth/{sign-in,sign-out,mfa/verify}`, `/api/v1/me`, `/api/health/**`). No public routes. |

## Layout

```
apps/
  user/     Next.js app (src/app, src/components, src/i18n/{server.ts,messages}, src/proxy.ts, instrumentation)
  admin/    Next.js app (src/app/[locale]/(console)|(auth), src/components/admin + its OWN copies of the shared UI it
            uses, src/app/globals.css with the dense "Realy Control" theme, src/i18n, src/proxy.ts)
packages/
  backend/       src/server/** (core + domain modules) and src/worker/** (`pnpm worker`)
  database/      prisma/** (schema, migrations, seed), prisma.config.ts, generated client in src/generated (gitignored)
  auth-core/     per-app session cookie names/options (`@realy/auth-core`)
  api-client/    browser API client: src/core.ts + entry points src/user.ts (user app) and src/admin.ts (admin app)
  shared-utils/  src/lib (cn, safe-next, …) and the i18n runtime (config, translate, format, client provider,
                 locale negotiation) — not the messages
  shared-types/  types shared by backend and UI (e.g. objectives/plan-review draft types)
scripts/         deploy-db.mjs (user build only), vercel-ignore.mjs, i18n-sync.mjs, grant-role.ts, split/
tests/           unit / integration (vitest, root config) and e2e (Playwright)
```

Code keeps its import specifiers: `@/server/…`, `@/generated/…`, `@/lib/…`, `@/i18n/…` resolve into the packages
through each app's `tsconfig.json` `paths` (Turbopack applies the app's tsconfig to every file it compiles, including
files in `packages/`), `@/components/…` and `@/app/…` resolve inside the app. Each app sets `turbopack.root` and
`outputFileTracingRoot` to the monorepo root so files in `packages/` are compiled and traced. Packages are consumed
as TypeScript source (no build step); each declares its own npm dependencies (pnpm links one `next`/`react` instance).

Per-app specifiers (the same name, a different file per app):

| Specifier | apps/user | apps/admin | packages (worker, seed: tsx) |
|---|---|---|---|
| `@/lib/api-client` | `packages/api-client/src/user.ts` | `packages/api-client/src/admin.ts` | — |
| `@/i18n/server` | `apps/user/src/i18n/server.ts` | `apps/admin/src/i18n/server.ts` | provided by the app |
| `@/i18n/messages/*` | user catalogs | admin catalogs | provided by the app; user catalogs under tsx |

## Isolation rules

1. `apps/user` never imports `apps/admin`, `src/components/admin`, or the admin API-client entry — and vice versa.
2. Packages never import an app (`@/components/*`, `@/app/*`, `apps/**`). Only `@/i18n/server` and
   `@/i18n/messages/*` are "app-provided" and may be used by packages.
3. The admin app reuses shared UI (`ui`, `motion`, `graphics`, brand, form-error, language-switcher, providers) as its
   **own copy** so the Control Center design system can diverge. Business logic lives once, in `packages/backend`.

Enforced by `pnpm check:boundaries` (`scripts/split/check-boundaries.mjs`: resolves every import through each
project's aliases) in CI, and by `no-restricted-imports` rules in `eslint.config.mjs`.

## Auth and sessions

- **Distinct cookies** (`packages/auth-core`): the user app uses `realy_session` (unchanged, SameSite=Lax); the admin
  app uses `__Host-realy_admin_session` in production (`realy_admin_session` in development), SameSite=Strict. Both are
  host-only. Each app's `next.config.ts` sets `env.REALY_APP`, which Next inlines, so the shared backend code
  (`route()`, `getSession()`, sign-in/out handlers) reads and writes the cookie of the app it is compiled into. A user
  session never authenticates the admin app; signing out of one does not sign out of the other.
- **User app proxy** (`apps/user/src/proxy.ts`): locale routing, per-request CSP nonce, trusted `x-realy-path`;
  `/[locale]/admin/**` redirects to `ADMIN_URL` (re-rooted) or 404s. The user session is validated in the data access
  layer (`requireViewer`, `route()`).
- **Admin app proxy** (`apps/admin/src/proxy.ts`): every page and API request except the login/MFA pages, the
  sign-in/MFA/sign-out endpoints and health checks runs `verifyConsoleAccess`
  (`packages/backend/src/server/modules/admin/console-gate.ts`) **server-side against the database**: a live admin
  session, MFA completed, a platform-scoped role (PLATFORM/REGION/COUNTRY — the same `isPlatformAdmin` check
  maintenance mode uses) and a fresh MFA verification (12 h, `MFA_FRESHNESS_MS`; `REALY_DEV_RELAX_MFA=true` relaxes
  it in development only). Pages redirect to `/[locale]/login` or `/[locale]/mfa`; APIs answer 401/403 with the
  standard error envelope. Admins without an MFA factor are sent to the MFA page, which links to the user app's
  Settings → Security to enrol. Route handlers still authorize each action (`requirePlatform`), so the proxy is the
  perimeter, not the only check. CSP nonce and `X-Robots-Tag: noindex` on every response.

## i18n

`apps/user/src/i18n/messages/<locale>.json` holds every product namespace (source of truth). The admin catalogs hold
the admin-owned namespace(s) (`admin`) plus **copies** of the product namespaces the Control Center uses (`common`,
`errors`, `auth`, `authHero`, …). Edit shared strings in `apps/user` only, then `pnpm i18n:sync` (CI runs
`pnpm i18n:check`; `node scripts/i18n-sync.mjs --add <namespace>` starts using another namespace in the admin app).
The worker and the seed (tsx) use the user catalogs. User-facing strings formerly under `admin.unavailable` /
`admin.modules` now live in `unavailable` / `platformModules`.

## Single-app gating removed

The old `APP_SURFACE` variable (one deployment serving `user`, `admin` or both) is gone: the apps are separate builds.
Remove `APP_SURFACE` from every environment. `ADMIN_URL` (user app → console links/redirects) and `USER_APP_URL`
(admin app → "Open the app", password reset, MFA enrolment links) remain.

## Database migrations — exactly once per release

Only the **user** app's build runs `scripts/deploy-db.mjs` (`prisma migrate deploy` + reference seed, on Vercel or with
`RUN_DB_MIGRATIONS=true`). The admin build only runs `prisma generate` and `next build`. Migrations are additive, so
an admin deployment built from the same commit is safe while the user build applies them; when a release needs new
columns in the console, promote the admin deployment after the user deployment is live.

## Containers and the worker

`Dockerfile` builds one image per app (`--build-arg APP=user|admin`, default `user`; web target `runtime`, working
directory `apps/<app>`). `--target worker` is the background worker (working directory `packages/backend`, command
`node_modules/.bin/tsx src/worker/index.ts`), so `deploy/worker/*` (Render, Fly) work unchanged. Migrations run in
`/app/packages/database` (`docker-compose.yml` sets `working_dir` for the `migrate` service).

## Local development

```bash
cp .env.example .env          # one .env at the repo root (both apps, worker and prisma read it)
pnpm install                  # also generates the Prisma client (packages/database postinstall)
pnpm db:migrate && pnpm db:seed
pnpm dev:user                 # http://localhost:3000
pnpm dev:admin                # http://localhost:3001   (set ADMIN_URL=http://localhost:3001, USER_APP_URL=http://localhost:3000)
pnpm worker
pnpm typecheck                # both apps (next typegen + tsc)
pnpm check:boundaries && pnpm i18n:check
```

## Vercel setup (owner steps)

Create **two Vercel projects** from the same Git repository:

| | User app | Admin app |
|---|---|---|
| Project name | `realy-user` (the existing project can be reused) | `realy-admin` (the existing admin-surface project can be reused) |
| Root Directory | `apps/user` | `apps/admin` |
| Framework preset | Next.js | Next.js |
| "Include source files outside of the Root Directory" | **enabled** (default) | **enabled** (default) |
| Install / Build | from `apps/user/vercel.json` (`pnpm install --frozen-lockfile`, `pnpm run build`) | from `apps/admin/vercel.json` |
| Ignored Build Step | `node ../../scripts/vercel-ignore.mjs user` (in vercel.json) | `node ../../scripts/vercel-ignore.mjs admin` |
| Domain | `app.realy.si` | `admin.realy.si` |
| Node.js | 22.x | 22.x |

The ignored build step rebuilds an app only when `apps/<app>/`, `packages/`, the lockfile/workspace config or the
deploy scripts changed since its last deployment (`VERCEL_GIT_PREVIOUS_SHA`), so admin-only changes never rebuild
the user app and vice versa. It builds whenever it cannot tell.

Environment variables (names only; set per environment — Production / Preview):

- **Both projects:** `DATABASE_URL`, `REDIS_URL`, `REALY_ENCRYPTION_KEY` (same key in both — it decrypts the same
  data), `TRUSTED_PROXY_HOPS`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY` (admin reads
  billing state), `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, `ANTHROPIC_API_KEY`,
  `AGENT_MODEL`, `AGENT_ALLOWED_MODELS`, `AI_DAILY_TOKEN_LIMIT`.
- **User project only:** `APP_URL=https://app.realy.si`, `ADMIN_URL=https://admin.realy.si`, `DIRECT_DATABASE_URL`
  (migrations), `SKIP_DB_MIGRATIONS` (optional), `REALY_BOOTSTRAP_ADMIN_EMAIL` (first run only),
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_AUTOMATIC_TAX`, all `OAUTH_*`, integration OAuth apps (`SLACK_*`, `HUBSPOT_*`,
  `SALESFORCE_*`, `LINKEDIN_*`, `X_*`, `FACEBOOK_*`, `QUICKBOOKS_*`, `XERO_*`, `TIKTOK_*`, `THREADS_*`, `PINTEREST_*`,
  `MAILCHIMP_*`, `GOOGLE_ADS_*`).
- **Admin project only:** `APP_URL=https://app.realy.si` (links in e-mails sent from the console point at the
  product), `USER_APP_URL=https://app.realy.si`. Never set `DIRECT_DATABASE_URL`, `RUN_DB_MIGRATIONS` or
  `REALY_DEV_RELAX_MFA` here.
- **Remove everywhere:** `APP_SURFACE`.

DNS: point `app.realy.si` and `admin.realy.si` (CNAME `cname.vercel-dns.com`) at their projects. Optionally restrict
the admin project further with Vercel Deployment Protection / Trusted IPs (the app enforces platform roles and MFA
regardless).

## Re-running the transformation

`scripts/split/run.mjs` migrates a checkout of the old single-app layout (`src/`, `prisma/`) in place:

```bash
node scripts/split/run.mjs --dry-run   # plan + validate, change nothing
node scripts/split/run.mjs             # write apps/, packages/, root configs; remove src/ and prisma/
pnpm install && pnpm typecheck && pnpm check:boundaries
```

It classifies files by directory rules (`scripts/split/config.mjs` → `RULES`), so new routes, components and modules
land in the right place; it stops without changing anything on an unclassified path, an import across the user/admin
boundary, a changed superseded file (`SUPERSEDED` hashes) or a patch that no longer applies. Templates live in
`scripts/split/templates/**`. A migrated tree is detected and left alone.
