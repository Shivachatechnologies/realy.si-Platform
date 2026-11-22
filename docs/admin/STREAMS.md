# Control Center workstreams (A–F): file ownership and hotspot rules

Six streams build the Super Admin Control Center (`apps/admin`) in parallel. Step 0 (this layout) split every
mixed file and added registries, so each stream edits only its own files. **If a change needs a file you do not
own, ask its owner; do not edit it in your branch.**

Path abbreviations:

| Abbrev | Path |
|---|---|
| `AA/` | `apps/admin/src/app/[locale]/(console)/` (console pages) |
| `AAPI/` | `apps/admin/src/app/api/v1/admin/` (admin route handlers) |
| `AC/` | `apps/admin/src/components/admin/` |
| `AUI/` | `apps/admin/src/components/ui/` |
| `BE/` | `packages/backend/src/server/modules/` |
| `CORE/` | `packages/backend/src/server/core/` |
| `WK/` | `packages/backend/src/worker/` |
| `SCH/` | `packages/database/prisma/schema/` |
| `I18N` | `apps/admin/src/i18n/messages/{en-US,de-DE,hi-IN,ar-AE,zh-CN}.json` |

## Registries (append-only extension points)

| Registry | Owner (index) | Each stream edits only | Shape |
|---|---|---|---|
| Sidebar navigation | A: `AC/nav/registry.ts`, `AC/nav/types.ts`, `AC/admin-sidebar.tsx` | `AC/nav/sections/<a…f>.ts` | `NavSection {id, href, label (full message key), icon, order, perms, group?, badge?, children?}`; sorted by `order` |
| Breadcrumbs | A: `AC/nav/breadcrumbs.tsx` (`AdminBreadcrumbs`), `navTrail()` in `AC/nav/registry.ts` | (derived from your nav section) | pass `extra` items for entity names |
| Global search (server) | A: `BE/admin/search/index.ts`, `BE/admin/search/types.ts`, `AAPI/search/route.ts` | `BE/admin/search/providers/{people,ai,billing,ops,platform}.ts` (B, C, D, E, F) | `defineSearchProvider({group, perms, empty, search(ctx, q)})`; result keys unique across providers |
| ⌘K palette (client) | A: `AC/palette/registry.ts`, `AC/palette/types.ts` | `AC/palette/sources/<a…f>.ts` | `PaletteSource {group, label, order, hits(ctx)}`; static commands via `commandSource({…, commands})` |
| Status badge tones | A: `AC/status-badge.tsx` (`StatusBadge`, `statusTone`) | `AC/status/<a…f>.ts` | `{ <domain>: { <ENUM_VALUE>: tone } }`; domain names unique |
| Admin notifications | A: `BE/admin/notifications.ts` (`notifyAdmins`, a no-op until A8) | (call it) | `notifyAdmins(ctx, {permission \| userId, type, severity, title, href, dedupeKey})` |
| Prisma schema | each stream | `SCH/admin-<a…f>.prisma` | see the schema rules below |
| i18n | each stream | its own `admin.<group>` objects (table below) | all 5 locales in one commit |

Nav `order` values in use: overview 10 (A), users 20 (B), companies 30 (B), ai 40 (C), billing 50 (D),
content 60 (F), marketplace 70 (F), features 80 (F), integrations 90 (F), system 100 (E), security & audit 110 (F),
settings 120 (F). Pick a free value (for example 45, 105) for a new section. Palette source orders in use:
controls 10 (F), users 20, organizations 30, companies 40 (B), tasks 50 (C), integrations 60 (F).

## Starter UI kit (Step 0; stream A owns and refines)

| Component | File |
|---|---|
| `ToastProvider`, `useToast()` (mounted in `AA/layout.tsx`) | `AUI/toast.tsx` |
| `useAdminAction(defaults?)` → `run(path, method, body, {success?, toastError?})` toasts on success | `AC/action-dialog.tsx` |
| `Skeleton`, `SkeletonText`, `SkeletonTable` | `AUI/skeleton.tsx` |
| `Breadcrumbs` (presentational) | `AUI/breadcrumbs.tsx` |
| `AdminBreadcrumbs` (from the nav registry) | `AC/nav/breadcrumbs.tsx` |
| `CopyButton` | `AC/copy-button.tsx` |
| `Timestamp` (absolute + relative, viewer time zone, zone in tooltip) | `AC/timestamp.tsx` |
| `StatusBadge`, `statusTone`, `STATUS_TONES` | `AC/status-badge.tsx` |
| `EnvBadge`, `environmentInfo()` (`VERCEL_ENV` / `NODE_ENV`, `VERCEL_GIT_COMMIT_SHA`) | `AC/env-badge.tsx` |

Kit strings live in `admin.shell` (A).

## Permissions and section gate (Step 0 added every key; later changes go through B)

New platform permissions (`BE/rbac/catalog.ts`, all `platformOnly`, so never for agents):

| Key | MFA-gated | Granted in code (besides SUPER_ADMIN, which holds every platform key) |
|---|---|---|
| `platform.incidents.read` | | PLATFORM_ADMIN, SECURITY_ADMIN, AI_OPERATIONS_ADMIN, READ_ONLY_ADMIN |
| `platform.incidents.manage` | | PLATFORM_ADMIN |
| `platform.alerts.manage` | | PLATFORM_ADMIN |
| `platform.billing.refund` | yes | BILLING_ADMIN |
| `platform.roles.manage` | yes | — |
| `platform.impersonate` | yes | — |
| `platform.data.read` | | PLATFORM_ADMIN, READ_ONLY_ADMIN |
| `platform.data.export` | yes | — |
| `platform.logs.read` | | PLATFORM_ADMIN, SECURITY_ADMIN, AI_OPERATIONS_ADMIN, READ_ONLY_ADMIN |
| `platform.copilot.use` | | PLATFORM_ADMIN, AI_OPERATIONS_ADMIN |

`platform.support.*` is reused for platform support tickets. MFA gaps fixed: `platform.organizations.manage`,
`platform.subscriptions.manage` and `platform.support.manage` are now MFA-gated.

Roles are defined in code (`SYSTEM_ROLES`) and written by the seed (`pnpm db:seed`, also run by
`scripts/deploy-db.mjs`); a new grant reaches a database only after the seed runs there.

`BE/admin/console-gate.ts` `SECTIONS` already has placeholder entries for: `access-reviews`, `impersonation` (B);
`workflows`, `knowledge`, `copilot` (C); `invoices`, `payments`, `refunds`, `credits`, `usage`, `growth`,
`analytics` (D); `health`, `incidents`, `alerts`, `infra`, `logs`, `errors`, `releases`, `data` (E); `support`,
`email`, `telephony`, `files`, `api-logs` (F; `webhooks` existed). `OPEN_SECTIONS` (any platform role):
`search`, `actions`, `notifications`, `me` (A). `roles` also accepts `platform.roles.manage`.

UI capability hints: `capabilitiesFor(ctx, keys)` in `BE/admin/access.ts` (never enforcement; every backend
function still calls `requirePlatform` / `requireAnyPlatform`).

## Shared hotspots (all streams)

| Hotspot | Owner | Rule |
|---|---|---|
| `AC/nav/registry.ts`, `AC/nav/types.ts`, `AC/admin-sidebar.tsx` | A | Streams edit only `AC/nav/sections/<stream>.ts` |
| `AC/palette/registry.ts`, `AC/palette/types.ts` | A | Streams edit only `AC/palette/sources/<stream>.ts` |
| `BE/admin/search/index.ts`, `BE/admin/search/types.ts`, `AAPI/search/route.ts`, `AA/search/page.tsx` | A | Streams edit only `BE/admin/search/providers/<theirs>.ts`. The `/search` page still renders the Step 0 groups; A makes it registry-driven. |
| `AC/status-badge.tsx` | A | Streams edit only `AC/status/<stream>.ts` |
| `BE/admin/trends.ts` shared helpers (`trendDays`, `since`, `fill`, `fillAi`, `aiByDay`) | A | B (`people-trends.ts`) and C (`ai-trends.ts`) import them; A keeps their signatures stable |
| `I18N` (5 files) | each stream, inside its own `admin.<group>` objects | Add all 5 locales in the same commit. Never touch other groups, never reorder or reformat (files are `JSON.stringify(…, null, 2)` + newline, as `pnpm i18n:sync` writes them). Shared strings (`common`, `errors`, …) are edited only in `apps/user`, then `pnpm i18n:sync`; ask A. `admin.nav` and `admin.common` belong to A: new nav labels go in your own group (for example `admin.incidents.nav`). `client-namespaces.json` is regenerated by `pnpm i18n:sync`, never hand-merged. Run `pnpm i18n:check` after each rebase. |
| `BE/rbac/catalog.ts`, seed role grants (`SYSTEM_ROLES`) | B | Step 0 added every key. Later changes go through B only. |
| `BE/admin/console-gate.ts` `SECTIONS`, `BE/admin/access.ts` | B | Step 0 added every section. Later changes go through B. |
| `BE/events/catalog.ts` | E | New event types only through E. Consumers live in their own `jobs.ts`. |
| `CORE/platform-controls.ts` (`CONTROL_DEFS`) | F | New controls go to F by request. |
| `CORE/http.ts` (error and request hooks) | E | E adds a single `onRequestComplete` / `onError` hook registry. F registers the API request logger. No other stream edits `http.ts`. |
| `CORE/rate-limit.ts` | F | One `onLimited` callback |
| `BE/agents/runtime.ts`, `BE/agents/router.ts` | C | Only C. The AI request log write lives here. |
| `BE/billing/stripe-billing.ts` (webhook handler) | D | Only D. `apps/user/src/app/api/v1/webhooks/stripe/route.ts` stays untouched. |
| `SCH/core.prisma` | B (User, Organization, Session fields; `UserStatus`; `FeatureFlagRule` on F's request), C (`AgentTaskStatus` only) | Nobody else. No new back-relations. |
| `SCH/admin-<stream>.prisma` | that stream | New platform tables carry plain `organizationId String? @map("organization_id") @db.Uuid` (or `companyId`) columns **without** a Prisma relation to `Organization`/`Company`, plus an index; existence is checked in code (the `worker_job_runs.organization_id` pattern). No back-relation lines in `core.prisma`. |
| `packages/database/prisma/migrations/` | each stream | At most one migration per PR. Reserved timestamp minute per stream: A `…_10xx`, B `…_20xx`, C `…_30xx`, D `…_40xx`, E `…_50xx`, F `…_60xx`. Merge serially; rebase and regenerate (`pnpm db:migrate:dev --create-only`). Keep the `brain_embeddings_hnsw` drift exclusion. |
| `WK/index.ts`, `WK/modules.ts`, `WK/schedules.ts` | E | Other streams add jobs in their module `jobs.ts`; E registers them. |
| `apps/user/**` | listed per stream | Only the named new files: B `apps/user/src/app/[locale]/impersonate/[token]/**`; F `apps/user/src/app/api/v1/webhooks/email/[provider]/route.ts`, `apps/user/src/app/[locale]/(app)/help/contact-realy/**`, `apps/user/src/app/api/v1/platform-support/**`; D nothing |
| `tests/` | each stream | New files only: `tests/unit/admin-<stream>-*.test.ts`, `tests/integration/admin-<stream>-*.test.ts` |

## Stream A — shell, design system, palette, command center, action center, notifications, personalization

- Pages: `AA/layout.tsx`, `AA/page.tsx`, `AA/search/page.tsx`, `AA/loading.tsx`, `AA/error.tsx`, `AA/actions/**`, `AA/notifications/**`, `AA/me/**`
- Components: `AC/admin-sidebar.tsx`, `AC/nav/registry.ts`, `AC/nav/types.ts`, `AC/nav/breadcrumbs.tsx`, `AC/nav/sections/a.ts`, `AC/palette/registry.ts`, `AC/palette/types.ts`, `AC/palette/sources/a.ts`, `AC/palette/**` (new), `AC/kit.tsx`, `AC/viz.tsx`, `AC/drawer.tsx`, `AC/action-dialog.tsx`, `AC/reason-dialog.tsx`, `AC/data-table/**`, `AC/copy-button.tsx`, `AC/timestamp.tsx`, `AC/status-badge.tsx`, `AC/status/types.ts`, `AC/status/a.ts`, `AC/env-badge.tsx`, `AUI/**`, `apps/admin/src/components/shell/**`, `apps/admin/src/components/providers.tsx`, `apps/admin/src/app/globals.css`
- Backend: `BE/admin/overview.ts`, `BE/admin/trends.ts`, `BE/admin/search/index.ts`, `BE/admin/search/types.ts`, `BE/admin/action-center.ts`, `BE/admin/notifications.ts`, `BE/admin/preferences.ts`
- API: `AAPI/search/**`, `AAPI/me/**`, `AAPI/notifications/**`
- Schema: `SCH/admin-a.prisma`
- i18n: `admin.{title,nav,common,search,emergency,overview,overviewSubtitle,yourAccess,mfaNotice,noAccess,signInTitle,signInSubtitle,openApp,live,health,shell,actions,notifications,me,palette}`

## Stream B — users, organizations, RBAC, impersonation

- Pages: `AA/users/**`, `AA/organizations/**` (except `organizations/[orgId]/integrations`, F), `AA/roles/**` (incl. new `roles/matrix`, `roles/reviews/**`, `roles/[roleId]`)
- Components: `AC/user-actions.tsx`, `AC/user-status-button.tsx`, `AC/people-actions.tsx`, `AC/people-extras.tsx`, `AC/org-actions.tsx`, `AC/people/**` (incl. `AC/people/role-actions.tsx`: `RoleGrant`, `RoleRevoke`, `ViewAsForm`), `AC/nav/sections/b.ts`, `AC/palette/sources/b.ts`, `AC/status/b.ts`
- Backend: `BE/admin/{users,people,tenants,roles,access,console-gate,people-trends,impersonation,access-reviews}.ts`, `BE/admin/search/providers/people.ts`, `BE/rbac/**`
- API: `AAPI/users/**`, `AAPI/organizations/**` (except `integration-logs`, `own-accounts`), `AAPI/roles/**`, `AAPI/notes/**`, `AAPI/access-reviews/**`, `AAPI/impersonation/**`
- Schema: `SCH/admin-b.prisma`, `SCH/admin.prisma` (`AdminNote`); `SCH/core.prisma` (User, Organization, Session fields only)
- i18n: `admin.{users,organizations,people,roles,access}`

## Stream C — AI platform, workforce, tasks, memory, workflows, copilot

- Pages: `AA/ai/**` (incl. new `ai/requests`, `ai/budgets`, `ai/tasks/[taskId]`, `ai/workforce/[employeeId]`, `ai/providers/[key]`), `AA/workflows/**`, `AA/knowledge/**`, `AA/copilot/**`
- Components: `AC/ai-models-editor.tsx`, `AC/ai-tier-editor.tsx`, `AC/ai/**` (incl. `AC/ai/ai-routing-editors.tsx`: `FallbackChainEditor`, `CreditEditor`; `AC/ai/employee-admin.tsx`: `EmployeeAdmin`), `AC/copilot/**`, `AC/nav/sections/c.ts`, `AC/palette/sources/c.ts`, `AC/status/c.ts`
- Backend: `BE/admin/{ai,ai-models,ai-ops,ai-trends,ai-requests,ai-budgets,workflows-admin,knowledge-admin,copilot,copilot-tools}.ts`, `BE/admin/search/providers/ai.ts`, `BE/agents/{runtime,router}.ts` (request-log write only), `BE/costs/**` (admin reads)
- API: `AAPI/ai/**`, `AAPI/workflows/**`, `AAPI/knowledge/**`, `AAPI/copilot/**`
- Schema: `SCH/admin-c.prisma`; `SCH/core.prisma` `AgentTaskStatus` only
- i18n: `admin.{ai,aiModels,aiWorkforce,aiErrors,aiRequests,aiBudgets,workflows,knowledge,copilot}`

## Stream D — billing, revenue, credits, usage, growth analytics

- Pages: `AA/{pricing,plans,subscriptions,revenue,countries}/**`, new `AA/{invoices,payments,credits,usage,growth,analytics}/**`, `AA/subscriptions/[subscriptionId]`
- Components: `AC/{pricing-console,plan-limits,country-billing-toggle}.tsx`, `AC/pricing-types.ts`, `AC/plans/**`, `AC/billing/**`, `AC/nav/sections/d.ts`, `AC/palette/sources/d.ts`, `AC/status/d.ts`
- Backend: `BE/admin/{billing,revenue,growth,analytics,credits}.ts`, `BE/admin/search/providers/billing.ts`, `BE/billing/**`, `BE/entitlements/**`, `BE/pricing/**`, `BE/globalization/**` (admin parts)
- API: `AAPI/{plans,prices,promotions,entitlements,countries,regions,invoices,payments,refunds,credits,subscriptions}/**`
- Schema: `SCH/admin-d.prisma`
- i18n: `admin.{pricing,plans,subscriptions,revenue,countries,invoices,payments,credits,usage,growth,analytics}`

## Stream E — health, incidents, alerts, infra, jobs, logs, errors, releases, environment, data ops

- Pages: `AA/system/**`, `AA/ops/**`, new `AA/{health,incidents,alerts,infra,logs,errors,releases,data}/**`
- Components: `AC/job-actions.tsx`, `AC/ops/**` (incl. `AC/ops/maintenance-toggle.tsx`: `MaintenanceToggle`), `AC/nav/sections/e.ts`, `AC/palette/sources/e.ts`, `AC/status/e.ts`
- Backend: `BE/admin/{monitoring,system-status,ops,health,incidents,alerts,infra,logs,errors,releases,data-ops}.ts` (`ops.ts` now holds only `opsOverview` and `setMaintenance`), `BE/admin/search/providers/ops.ts`, `CORE/job-admin.ts`, `CORE/jobs.ts`, `CORE/observability.ts`, `CORE/http.ts` (hook registry only), `CORE/logger.ts`, `WK/**`, `BE/events/catalog.ts`
- Also: `apps/admin/src/app/api/health/**`, `apps/admin/src/instrumentation.ts`, `apps/user/src/instrumentation.ts` (release recording only)
- API: `AAPI/{jobs,ops,health,incidents,alerts,infra,logs,errors,releases,data}/**`
- Schema: `SCH/admin-e.prisma`, `SCH/worker.prisma`
- i18n: `admin.{system,ops,incidents,alerts,infra,logs,errors,releases,data}` (`admin.health` is the overview health ring, A)

## Stream F — security, audit, integrations, developer, webhooks, email, telephony, files, support, CMS, settings

- Pages: `AA/{audit,security,integrations,developers,keys,cms,email-templates,announcements,marketplace,controls,settings,flags}/**`, `AA/organizations/[orgId]/integrations/page.tsx`, new `AA/{support,email,telephony,files,webhooks,api-logs}/**`
- Components: `AC/{cms-actions,cms-editor,cms-preview,email-template-editor,flags,platform-actions,platform-keys,control-editors,own-account-setup}.tsx`, `AC/security/**` (incl. `AC/security/revoke-session.tsx`: `RevokeSession`), `AC/support/**`, `AC/nav/sections/f.ts`, `AC/palette/sources/f.ts`, `AC/status/f.ts`
- Backend: `BE/admin/{security,security-access,developers,integrations,org-integrations,platform-secrets,marketplace,announcements,controls,support,email-admin,telephony-admin,files-admin,webhooks-admin,api-logs}.ts`, `BE/admin/search/providers/platform.ts`, `BE/flags/**`, `BE/cms/**`, `BE/email/**`, `BE/audit/**`, `CORE/platform-controls.ts`, `CORE/platform-secrets-catalog.ts`, `CORE/rate-limit.ts`
- API: `AAPI/{audit-logs,api-keys,banner,cms,controls,email-templates,feature-flags,feature-flag-rules,integration-connections,marketplace,platform-secrets,webhooks,sessions,announcements,support,email,telephony,files,api-logs}/**`, `AAPI/organizations/[orgId]/{integration-logs,own-accounts}/**`
- User app (new files only): `apps/user/src/app/api/v1/webhooks/email/[provider]/route.ts`, `apps/user/src/app/[locale]/(app)/help/contact-realy/**`, `apps/user/src/app/api/v1/platform-support/**`
- Schema: `SCH/admin-f.prisma`
- i18n: `admin.{audit,security,securityAccess,integrations,developers,keys,cms,emailTemplates,announcements,marketplace,controls,settings,flags,ownAccounts,requestLog,support,email,telephony,files,webhooks,apiLogs}`

## Step 0 file moves (for rebasing older branches)

| Before | After |
|---|---|
| `AC/people-actions.tsx` `RevokeSession` | `AC/security/revoke-session.tsx` (F) |
| `AC/people-actions.tsx` `MaintenanceToggle` | `AC/ops/maintenance-toggle.tsx` (E) |
| `AC/people-actions.tsx` `FallbackChainEditor`, `CreditEditor` | `AC/ai/ai-routing-editors.tsx` (C) |
| `AC/people-actions.tsx` `EmployeeAdmin` | `AC/ai/employee-admin.tsx` (C) |
| `AC/platform-actions.tsx` `RoleGrant`, `RoleRevoke`, `ViewAsForm` | `AC/people/role-actions.tsx` (B) |
| `BE/admin/ops.ts` `aiRouting`, `fallbackModels`, `aiRoutingInput`, `updateAiRouting`, `aiErrors`, `employeeAdminInput`, `getEmployeeAdmin`, `updateEmployeeAdmin` | `BE/admin/ai-ops.ts` (C) |
| `BE/admin/ops.ts` `securityHistory`, `revokeSession`, `revokeSessionInput` | `BE/admin/security-access.ts` (F) |
| `BE/admin/trends.ts` `organizationTrends`, `userTrends` | `BE/admin/people-trends.ts` (B) |
| `BE/admin/trends.ts` `aiDailySeries` | `BE/admin/ai-trends.ts` (C) |
| `BE/admin/search.ts` | `BE/admin/search/index.ts` + `providers/*` |
| `ADMIN_SECTIONS` in `AC/admin-sidebar.tsx` | `AC/nav/sections/*.ts` via `ADMIN_NAV` |

All imports were updated; there are no re-export shims at the old paths.
