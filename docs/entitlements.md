# Plans & entitlements

One module decides what an organization's plan allows: `packages/backend/src/server/modules/entitlements/**`.

| File | What it holds |
|---|---|
| `catalog.ts` | Pure data (client-safe): plan keys, prices, feature keys, limit keys, add-ons, trial rules, integration category access. **Single source of truth** for the seed, enforcement, the pricing page and the admin console. |
| `service.ts` | `getEntitlements`, `hasFeature`, `assertFeature`, `checkLimit`, `assertLimit`, `recordUsage`, `consumeUsage`, `usageSummary`, `lockedFeatures`, `lockedNavHrefs`, `invalidateEntitlements`, `planTable`, `monthlyWindow`. No `server-only` import, so the worker can use it. |
| `routes-map.ts` | API route / app page → feature key (central enforcement). |
| `gate.ts` | `entitlementApiGate` (called by `core/http.ts` `route()`), `lockedFeatureForPage` (called by `server/workspace.ts` `requireOrgContext`). |
| `offers.ts` | `entitlementOverview` (plan, usage, plan offers, add-ons, checkout readiness) for the upgrade prompt and Billing & usage. |
| `seed.ts` | `seedPlanCatalog` (additive, idempotent). |
| `admin.ts` | Control Center: revenue & churn, org overrides, admin add-on grants, subscription change / cancellation. |

## Plans

| | Starter | Growth | Scale |
|---|---|---|---|
| Monthly (USD / EUR) | 99 | 199 | 999 |
| Annual (10× monthly, 2 months free) | 990 | 1,990 | 9,990 |
| Companies (`companies.max`) | 1 | 1 | 5 |
| AI employees (`agents.max`) | 3 | 10 | 50 |
| Human seats (`seats.max`) | 1 | 3 | 10 |
| CRM contacts (`crm.contacts.max`) | 1,000 | 10,000 | 100,000 |
| Content generations / month (`content.generations.month`) | 30 | 250 | 1,000 |
| Connected channels (`channels.max`) | 2 | 5 | 15 |
| Active automations (`automations.active.max`) | 5 | 25 | 100 |
| AI credits / month (`ai.credits.month`) | 10,000 | 50,000 | 300,000 |
| Storage (`storage.mb`) | 5 GB | 25 GB | 250 GB |
| Voice minutes / month (`voice.minutes.month`) | 0 | 0 | 500 |
| Email sends / month (`email.sends.month`) | 2,000 | 20,000 | 100,000 |
| External API spend cap / month, USD cents (`api.cost.month`) | $20 | $100 | $500 |
| Ad spend cap / month, USD cents (`ads.spend.month`) | $0 | $2,000 | $20,000 |

Features (`feature.*`) carry a `minPlan` in `catalog.ts` (e.g. `feature.voice_agent`, `feature.live_chat`, `feature.finance`,
`feature.hr`, `feature.projects_operations`, `feature.support_automation` → Scale; `feature.executive_team`,
`feature.lead_generation`, `feature.workflow_builder`, `feature.advanced_analytics`, `feature.autonomy_auto` → Growth).

* **AI credits**: 1 credit = 100 model tokens (input + output) — `creditsForTokens(tokens)`.
* **Autonomy**: `AUTONOMY_CEILING` — Starter: human approval for important actions (no Auto); Growth: Auto for low/medium
  risk (`feature.autonomy_auto`); Scale: custom autonomy per department (`feature.autonomy_custom`).
* **High-cost limits** (`highCost: true`: AI credits, content generations, voice minutes, email sends, API spend, ad spend)
  are never unlimited: a `null` in the database falls back to the catalog quota, and the admin APIs refuse `null`.
* **Integrations by plan** (`integrationCategoryAccess(category)`): `ads` → Growth, `accounting` and `developer` → Scale,
  everything else → all plans. Categories `social`, `ads`, `email`, `messaging` count toward `channels.max`.

## Resolution (`getEntitlements(orgId)`)

1. Live subscription (`ACTIVE`, `TRIALING`, `PAST_DUE`) → its plan. Values = the plan's `PlanEntitlement` rows over the
   catalog defaults of the matching catalog plan (legacy `founder` → Starter, `enterprise` → Scale). `PAST_DUE` keeps the plan.
2. **No subscription — trial**: an organization gets a **7-day no-card trial at Growth limits**. The clock starts when the organization starts using Realy — when its first company exists (new founders during onboarding; organizations that existed before plans launched start on their first visit after launch). Before that the trial has not started and onboarding runs at trial level. Stored in `entitlement_trials` (one row per organization, never reset).
3. **Trial ended without a subscription** (`trial_expired`): Starter features, **read-only for new usage** — every
   `checkLimit` with a positive increment is refused (`plan_trial_expired`, `requiredPlan: "starter"`), and writes to
   plan-feature routes are refused. Reading data always works; billing routes are never gated.
4. Per-organization **overrides** (`EntitlementOverride`, admin grants with reason + expiry) win over the plan.
5. Paid / granted **add-on packs** (`EntitlementAddonPurchase`, status `PAID`) raise their limit until the end of the
   organization's current monthly usage window.

Metered limits reset per **monthly window** anchored on the subscription's `currentPeriodStart` (annual plans still reset
monthly); without a subscription, the calendar month (UTC). Live limits are counted from real tables (companies, AI
employees, members + pending invitations, CRM contacts, active workflows, channel connections, stored bytes).

Cache: 30 s per organization, 60 s for the plan table. Invalidated by the Stripe webhook (subscription / add-on changes),
admin overrides and grants, and plan-entitlement edits (`pricing/service.ts setEntitlement`).

`ENTITLEMENTS_ENFORCEMENT=off` (env) turns every check into report-only (e2e suites, self-hosted installs).

## Errors

Both use `AppError("not_available", …)` (HTTP 422) with `details`:

* `plan_feature_locked`: `{ reason, feature, currentPlan, requiredPlan, state, organizationId }`
* `plan_limit_reached` / `plan_trial_expired`: `{ reason, limitKey, kind, used, limit, currentPlan, requiredPlan, addons, state, organizationId }`

The user app's `FormError` renders `UpgradePrompt` for these (apps/user/src/components/billing/upgrade-prompt.tsx).

## Central enforcement (done)

* `core/http.ts route()` → `entitlementApiGate` right after the platform-controls `requestGate` (org-scoped paths only,
  authenticated requests only). Map in `routes-map.ts`.
* `server/workspace.ts requireOrgContext` → `entitlementPageGate` after `platformPageGate`; redirects to
  `/[locale]/upgrade?feature=…&from=…`.
* Count limits wired in this change: `companies/service.ts createCompany` (`companies.max`),
  `organizations/service.ts inviteMember` (`seats.max`), `automation/service.ts setWorkflowStatus` (`automations.active.max`
  on activation), `integrations/connections.ts assertConnectionEntitled` called from `integrations/service.ts`
  `saveApiKeyConnection` + `startOAuthConnection` (category features + `channels.max`), `brain/service.ts ingestDocument`
  (`storage.mb`).

## Insertion points for modules owned by other engineers

Import once per file: `import { assertFeature, assertLimit, hasFeature, recordUsage, creditsForTokens } from "@/server/modules/entitlements/service";`

| Where | Call |
|---|---|
| `workforce/service.ts` `createEmployee`, before `tx.aiEmployee.create` | `await assertLimit(ctx, organizationId, "agents.max", 1);` |
| `marketplace/bridges.ts`, before `tx.aiEmployee.create` | `await assertLimit(ctx, organizationId, "agents.max", 1);` |
| `workforce/service.ts` `createEmployee` / `updateEmployee`, when `input.autonomy === "AUTONOMOUS_LOW_RISK"` | `await assertFeature(ctx, organizationId, "feature.autonomy_auto");` |
| `workforce/autonomy.ts` (per-department autonomy settings writer) | `await assertFeature(ctx, organizationId, "feature.autonomy_custom");` |
| `workforce/service.ts` `createEmployee`, when `input.level` is an executive / manager level (CEO, Chief of Staff, department manager) | `await assertFeature(ctx, organizationId, "feature.executive_team");` |
| `agents/service.ts` `createTask`, next to the platform `assertAiAllowed` check | `await assertLimit(ctx, organizationId, "ai.credits.month", 1);` |
| `agents/service.ts` `processAgentTask`, right after the COMPLETED `tx.agentTask.updateMany` (inside the same transaction) | `await recordUsage(task.organizationId, "ai.credits", creditsForTokens(result.inputTokens + result.outputTokens), { companyId: task.companyId, idempotencyKey: taskId, client: tx });` |
| `agents/service.ts` `processAgentTask` failure path where `failure.usage` is stored | `if (failure.usage) await recordUsage(task.organizationId, "ai.credits", creditsForTokens(failure.usage.inputTokens + failure.usage.outputTokens), { companyId: task.companyId, idempotencyKey: \`${taskId}:failed\` });` |
| `crm/contacts.ts` `insertContact`, before `tx.contact.create` (covers create, import, lead conversion) | `await assertLimit(ctx, organizationId, "crm.contacts.max", 1);` (CSV import: assert once with the row count before the loop) |
| `marketing/ai.ts` `requestAi` (content generation requests), before creating the AI task | `await assertLimit(ctx, organizationId, "content.generations.month", 1);` and after the task is created: `await recordUsage(organizationId, "content.generations", 1, { companyId, idempotencyKey: task.id });` |
| `marketing/social.ts` `createAccount` (a new social channel) | `await assertLimit(ctx, organizationId, "channels.max", 1);` |
| `marketing/autopilot.ts` `createAutopilot` and `autopilotAction` (start/resume) | `await assertFeature(ctx, organizationId, "feature.marketing_autopilot");` |
| `marketing/autopilot.ts` `runAutopilots` / `advanceItem` (worker), skip orgs that lost the feature | `if (!(await hasFeature(organizationId, "feature.marketing_autopilot"))) return;` |
| `marketing/campaigns.ts` create campaign / `marketing/ads.ts` create ad campaign | `await assertFeature(ctx, organizationId, "feature.ai_campaigns");` |
| `marketing/ads.ts`, before committing a budget on an ad platform (amount in USD cents) | `await assertLimit(ctx, organizationId, "ads.spend.month", budgetCents);` then after the platform confirms: `await recordUsage(organizationId, "ads.spend_cents", budgetCents, { companyId, idempotencyKey: adCampaignId });` |
| `marketing/sequences.ts` / `crm` sequences create + enroll | `await assertFeature(ctx, organizationId, "feature.email_automation");` |
| `marketing/mailer.ts` `sendMarketingEmail` callers (batch), before a send batch of `n` | `await assertLimit(null, organizationId, "email.sends.month", n);` and after each accepted send: `await recordUsage(organizationId, "email.sends", 1, { companyId, idempotencyKey: sendId });` |
| `crm` outreach / sequence email sends | same two lines as above with meter `"email.sends"` |
| `crm/discover`, `crm/prospects` services (lead generation) | `await assertFeature(ctx, organizationId, "feature.lead_generation");` (routes already gated centrally; add for AI tools) |
| voice module: start/accept a call | `await assertFeature(ctx, organizationId, "feature.voice_agent"); await assertLimit(ctx, organizationId, "voice.minutes.month", 1);` and at call end: `await recordUsage(organizationId, "voice.minutes", Math.ceil(durationSeconds / 60), { companyId, idempotencyKey: callId });` |
| livechat module: enable widget / start AI chat session | `await assertFeature(ctx, organizationId, "feature.live_chat");` |
| `integrations/client.ts` `providerFetch`, for paid research / enrichment / generation providers with a known cost (cents) | before: `await assertLimit(null, conn.organizationId!, "api.cost.month", costCents);` after a 2xx: `await recordUsage(conn.organizationId!, "api.cost_cents", costCents, { companyId: conn.companyId });` |
| guide / command module: AI answers (each AI run) | covered by the agents runtime metering above; for direct model calls outside agents: `await assertLimit(ctx, organizationId, "ai.credits.month", 1)` before and `await recordUsage(organizationId, "ai.credits", creditsForTokens(tokens), { companyId })` after |
| builder module: `builder/service.ts` advanced steps (multi-company blueprint, advanced research) | `await assertFeature(ctx, organizationId, "feature.company_builder_advanced");` |
| builder module: website/landing page publish | `await assertFeature(ctx, organizationId, "feature.website_builder");` |
| AI tools (`tools/define.ts` `def` handlers) that create the counted records above | call the same `assertLimit` inside the tool handler so AI employees hit the same limits as people |

Inside a transaction, prefer calling `assertLimit` **before** `transaction(...)` (it reads through `db()`), or accept the
small race (limits are soft by one under concurrent writes).

## Upgrade UX (user app)

* `components/billing/upgrade-prompt.tsx` — `UpgradePrompt` (client) + `upgradePropsFromError(err)` + `PlanLockBadge`.
* `components/form-error.tsx` renders the prompt for plan errors.
* `/[locale]/upgrade` — locked page landing (page guard).
* `/[locale]/settings/billing` — Billing & usage: plan, meters for every limit, change plan (monthly / annual), add-ons,
  invoices, cancel / resume.
* `/[locale]/pricing` — three plans, monthly/annual, comparison table and FAQ from `catalog.ts` + DB entitlements.

### Shell lock badge (owner of `components/shell/*` to apply)

1. `apps/user/src/app/[locale]/(app)/layout.tsx`: compute
   `const lockedHrefs = await lockedNavHrefs(org.id, NAV.flatMap((s) => s.items.map((i) => i.href)));`
   (`import { lockedNavHrefs } from "@/server/modules/entitlements/service"`) and pass `lockedHrefs` to `AppFrame` → `Sidebar`.
2. `components/shell/sidebar.tsx` `NavLinkBase`: accept `locked?: boolean` and render
   `{locked ? <PlanLockBadge /> : null}` after the label (`import { PlanLockBadge } from "@/components/billing/upgrade-prompt"`).

## API

User app: `GET /api/v1/organizations/:orgId/entitlements`, `POST …/billing/change-plan`, `POST …/billing/cancellation`,
`POST …/billing/addons` (+ existing `…/checkout/quote`, `…/checkout/session`, `…/billing/portal`).
Admin app: `POST /api/v1/admin/entitlements/overrides`, `DELETE /api/v1/admin/entitlements/overrides/:id`,
`POST /api/v1/admin/entitlements/addons`, `POST /api/v1/admin/entitlements/organizations/:orgId/subscription`,
`POST /api/v1/admin/entitlements/organizations/:orgId/cancellation` (+ existing plans / prices / promotions endpoints).

## Seed

`packages/database/prisma/seed.ts` calls `seedPlanCatalog` in every environment (after reference data). It upserts
plans `starter` / `growth` / `scale`, all catalog entitlement rows and USD (GLOBAL) + EUR (REGION EU) monthly and annual
prices. Admin edits win: catalog values are re-applied only when a plan's `catalog.version` row is older than
`CATALOG_VERSION`; then a seed-authored open price version with a different amount is end-dated and version+1 is added
(history is never rewritten). Nothing is deleted. In non-production the dev-only `founder` / `enterprise` plans are hidden
from the public page (existing subscriptions keep working through `LEGACY_PLAN_MAP`).
