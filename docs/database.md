# Realy — Database Model

> Status: **Frozen for Phase 1.** PostgreSQL 16 + pgvector, accessed through Prisma 7.
> `prisma/schema.prisma` is authoritative for implemented tables; this document is authoritative for
> conventions and for tables of later phases (which are added by migration in their phase, never
> speculatively).

## 1. Conventions

| Rule | Detail |
|---|---|
| Primary keys | `id uuid` generated as UUIDv7 (time-ordered → append-friendly B-tree). Reference tables keyed by natural ISO codes (`countries.code`, `currencies.code`, `locales.tag`). |
| Naming | snake_case tables/columns in Postgres (`@@map`/`@map`), camelCase in TypeScript. |
| Tenancy | Every tenant row has `organization_id NOT NULL`; company-owned rows also have `company_id`. Composite indexes **lead with** `organization_id`. |
| Timestamps | `created_at`, `updated_at` (`timestamptz`, UTC). Soft-delete via `deleted_at` only where recovery is a product requirement (companies, documents). |
| Money | `amount_minor BIGINT` + `currency CHAR(3)` (ISO 4217). Never `float`/`numeric` for stored amounts. Zero-decimal currencies (JPY) use minor unit = major unit, driven by `currencies.minor_units`. |
| Rates | Tax / discount rates stored as integer **basis points** (`1250` = 12.50 %). |
| Enums | Postgres enums via Prisma for closed sets (status, scope type); `text` + reference table for open sets (countries, locales, permissions). |
| JSON | `jsonb` only for genuinely schemaless payloads (event payloads, audit diffs, provider metadata). Anything queried relationally gets a column. |
| Pagination | Every list query is cursor-based on `(created_at, id)` or `id` (UUIDv7 is time-ordered). |
| History | Billing and pricing history is append-only (see `price_versions`). Audit logs are append-only (no UPDATE/DELETE grant for the app role in production). |

## 2. Entity map

```
users ─┬─ sessions, mfa_factors, mfa_recovery_codes, oauth_accounts
       └─ memberships ── organizations ─┬─ companies ─┬─ workspaces ── projects
                                        │             └─ (Phase 2+) products, customers, documents, …
                                        ├─ invitations, service_accounts, api_keys
                                        ├─ roles (custom) ── role_permissions ── permissions
                                        ├─ role_assignments (principal × role × scope)
                                        ├─ billing_profiles, subscriptions ── subscription_items ─▶ price_versions
                                        ├─ usage_records
                                        └─ audit_logs, events (outbox), notifications

regions ── countries ── (supported locales, currencies, tax_configs)
currencies, locales
billing_products ── plans ─┬─ prices ── price_versions
                           └─ plan_entitlements
promotions ── coupons
feature_flags ── feature_flag_rules
```

## 3. Phase 1 tables (implemented)

### Identity
* **users** — `email` (unique, stored lower-cased), `name`, `password_hash` (argon2id, nullable for
  OAuth/SSO-only users), `email_verified_at`, `locale` (BCP-47), `timezone` (IANA), `country_code`
  (where the person is — *not* the company), `status` (ACTIVE / SUSPENDED / DELETED), `mfa_enabled`.
* **sessions** — opaque random token; only `token_hash` (SHA-256) stored. `expires_at`,
  `last_seen_at`, `ip`, `user_agent`, `mfa_verified_at`, `active_organization_id`, `revoked_at`.
* **mfa_factors** — `type` (TOTP; WEBAUTHN reserved), `secret_encrypted` (AES-256-GCM envelope),
  `confirmed_at`. **mfa_recovery_codes** — hashed one-time codes.
* **oauth_accounts** — `(provider, provider_account_id)` unique → `user_id`. Login-provider accounts
  only; *integration* connections live in Realy Connect tables (Phase 5).

### Tenancy
* **organizations** — billing/security tenant. `slug` unique, `status`, `default_locale`.
* **memberships** — `(organization_id, user_id)` unique, `status` (ACTIVE / SUSPENDED).
* **invitations** — `email`, `role_id`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at`.
* **service_accounts** — non-human principals owned by an organization (CI, integrations).
* **api_keys** — `prefix` (displayable) + `key_hash`; bound to a principal (service account), scoped
  by that principal's role assignments; `expires_at`, `revoked_at`, `last_used_at`.
* **companies** — the primary business object. Globalization columns are deliberately independent:
  `incorporation_country_code`, `operating_country_codes text[]`, `target_market_codes text[]`,
  `base_currency`, `default_locale`, `timezone`, `data_region` (`us-east | eu-west | me-central |
  ap-south | ap-southeast`), plus `legal_name`, `stage`, `status`, `deleted_at`.
* **workspaces** — `(organization_id, company_id, slug)` unique.
* **projects** — `(organization_id, company_id, workspace_id)`; the lowest RBAC scope.

### RBAC
* **permissions** — `key` = `resource.action` (e.g. `pricing.manage`), `resource`, `action`,
  `description`, `platform_only` (cannot be granted inside an organization role).
* **roles** — system roles (`organization_id NULL`, `is_system true`, immutable) and custom roles
  (`organization_id` set). `key` unique per organization.
* **role_permissions** — role × permission.
* **role_assignments** — `principal_type` (USER / SERVICE_ACCOUNT / AGENT), `principal_id`, `role_id`,
  `scope_type` (PLATFORM / REGION / COUNTRY / ORGANIZATION / COMPANY / WORKSPACE / PROJECT),
  `scope_id` (`*` for platform, region/country **code**, or entity id), `organization_id` (null for
  platform/region/country scopes), `granted_by_id`, `expires_at`.
  _Mapping:_ the master prompt's `user_roles` and `custom_roles` are covered by
  `role_assignments` and `roles.organization_id` respectively.

### Globalization reference data
* **regions** — `code` (US, EU, UK, MIDDLE_EAST, INDIA, APAC), `name`, `default_currency`,
  `default_locale`, `timezone`, `data_region`, `status`, `config jsonb` (enabled products/integrations).
* **countries** — `code` (ISO 3166-1 alpha-2), `name`, `region_code`, `default_locale`,
  `supported_locales text[]`, `default_currency`, `supported_currencies text[]`, `billing_enabled`,
  `payment_methods text[]`, `status`, `config jsonb`.
  _Mapping:_ `country_configs` / `region_configs` are the typed columns + `config` of these rows.
* **currencies** — `code` (ISO 4217), `name`, `symbol`, `minor_units`, `enabled`.
* **locales** — `tag` (BCP-47: en-US, hi-IN, ar-AE, …), `language`, `name`, `native_name`,
  `direction` (LTR / RTL), `enabled`, `fallback_tag`. (_Mapping:_ `languages` + `locales`.)
* **tax_configs** — `country_code`, optional `subdivision` (US state, CA province), `tax_type`
  (VAT / GST / SALES_TAX / DIGITAL_SERVICES_TAX / NONE), `display_name`, `rate_bps` (reference rate
  for display/estimates only), `price_includes_tax`, `calculation` (STRIPE_TAX / MANUAL),
  `reverse_charge_b2b`, `effective_from`, `effective_to`, `status`.
  Authoritative tax at checkout is computed by the tax provider (Stripe Tax), never the frontend.

### Pricing & billing
* **billing_products** — sellable product lines (e.g. `realy-platform`). Named to avoid clashing with
  a company's own `products` (Phase 2).
* **plans** — `product_id`, `key` (free, founder, growth, enterprise), `name_key` (i18n),
  `status` (DRAFT / ACTIVE / DISABLED), `sort_order`, `default_trial_days`, `public`.
* **prices** — a plan's price in one *market* for one interval: `plan_id`, `interval` (MONTH / YEAR),
  `market_type` (GLOBAL / REGION / COUNTRY), `market_code` (`*`, region code, or country code),
  `currency`, `usage_type` (LICENSED / METERED / SEAT), `status`.
  Unique `(plan_id, interval, market_type, market_code)`.
* **price_versions** — immutable amounts over time: `price_id`, `version`, `amount_minor`,
  `currency`, `effective_from`, `effective_to` (null = open), `trial_days`, `stripe_price_id`,
  `created_by_id`, `reason`. Invariants (enforced in service, under row lock on the parent price):
  versions of one price never overlap; a version whose `effective_from` has passed is never edited —
  it is end-dated and a new version is created.
* **plan_entitlements** — `plan_id`, `feature_key`, `enabled`, `limit_value BIGINT NULL` (e.g.
  `agents.max = 20`).
* **promotions** / **coupons** — percent (bps) or fixed-amount (minor + currency) discounts,
  applicable plans, country/region restrictions, window, redemption caps.
* **billing_profiles** — one per organization: `billing_country_code`,
  `billing_country_confirmed_at`, `currency`, `legal_name`, `tax_ids jsonb`, `address jsonb`,
  `stripe_customer_id`.
* **subscriptions** — `organization_id`, `plan_id`, `status`, `currency`, `billing_country_code`,
  `current_period_start/end`, `trial_ends_at`, `cancel_at`, `stripe_subscription_id`.
* **subscription_items** — `price_version_id` **(the locked historical price)**, `quantity`,
  `unit_amount_minor` + `currency` snapshot. A price change never touches existing items; migration
  to a new version is an explicit, audited action.
* **usage_records** — metered usage: `meter` (ai.tokens, execution.minutes, storage.gb_hours, …),
  `quantity BIGINT`, `occurred_at`, `idempotency_key` unique. Partitioned monthly at scale.

### Platform controls
* **feature_flags** — `key`, `description`, `default_enabled`, `status`.
* **feature_flag_rules** — `target_type` (GLOBAL / REGION / COUNTRY / ORGANIZATION / COMPANY / USER /
  PLAN), `target_value`, `enabled`, `priority`. Most specific match wins (USER > COMPANY >
  ORGANIZATION > PLAN > COUNTRY > REGION > GLOBAL), then `priority`.
* **audit_logs** — append-only: `category` (TENANT / ADMIN / SECURITY), `organization_id`,
  `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `old_value jsonb`,
  `new_value jsonb`, `reason`, `request_id`, `ip`, `user_agent`, `created_at`.
  _Mapping:_ `admin_audit_logs` = `audit_logs WHERE category = 'ADMIN'`.
* **events** — transactional outbox (see `workflows.md`): `type`, `version`, `organization_id`,
  `company_id`, `aggregate_type`, `aggregate_id`, `payload jsonb`, `occurred_at`, `published_at`,
  `attempts`, `last_error`. Index on `(published_at) WHERE published_at IS NULL`.
* **notifications** — `organization_id`, `user_id`, `type`, `payload`, `read_at`.
* **idempotency_keys** — `(principal_id, endpoint, key)` unique, `request_hash`, `status`
  (`IN_PROGRESS` / `COMPLETED`), `response_status`, `response_body`, `completed_at`, `expires_at`
  (24 h; purged by the worker).
* **Phase 1.1 additions** — `email_verification_tokens`, `password_reset_tokens` (hashed, single use),
  `email_messages` (delivery log: template, status SENT/FAILED/NOT_CONFIGURED, provider id — never
  bodies or tokens), `stripe_events` (webhook ledger), Stripe ids on `plans`, `promotions` and
  `subscription_items` (`price_versions.stripe_price_id` and `billing_profiles.stripe_customer_id` already existed); `oauth_accounts.provider_email`.
* **checkout_sessions** _(Phase 1.1)_ — one row per Stripe Checkout Session Realy creates:
  `organization_id`, `status` (OPEN / COMPLETED / EXPIRED / FAILED), `stripe_session_id` (unique,
  null while being created), `url`, `price_version_id`, `coupon_code`, `expires_at`, `completed_at`.
  Partial unique index `checkout_sessions_one_open_per_org` (one OPEN row per organization) is the
  database-level checkout lock; `subscriptions_one_live_per_org` allows one subscription per
  organization in a live status. Both are hand-written in migration `20261015120000_checkout_sessions`
  (Prisma cannot declare partial indexes).
* **Tenant-consistency constraints (Phase 1.1)** — `companies`, `workspaces` and `subscriptions` carry
  a unique `(id, organization_id)`; `workspaces`, `projects` and `subscription_items` reference their
  parents through composite foreign keys including `organization_id`, so a row can never point at
  another organization's parent.

## 4. Later-phase tables (contract frozen, created in their phase)

| Phase | Tables |
|---|---|
| 2 Company OS | `products`, `customers`, `contacts`, `people` (company personnel), `vendors`, `documents`, `knowledge_sources`, `knowledge_chunks (embedding vector(1536), organization_id, company_id, acl jsonb)`, `graph_edges (organization_id, company_id, from_type, from_id, rel, to_type, to_id, properties, valid_from, valid_to)` |
| 3 Intelligence | `objectives`, `execution_plans` (named to avoid clashing with billing `plans`), `milestones`, `tasks` (self-referencing `parent_task_id` for subtasks, `depends_on uuid[]`), `task_runs`, `executions`, `approvals`, `decisions` |
| 4 Workforce | `agents` (config row on the shared runtime), `agent_skills`, `agent_tools`, `agent_permissions` (→ `role_assignments` with `principal_type=AGENT`), `agent_memory`, `agent_budgets`, `agent_metrics` |
| 3–4 Workflows | `workflows`, `workflow_versions`, `workflow_runs`, `workflow_steps`, `workflow_step_runs`, `schedules` |
| 5 Connect | `integrations` (provider catalog), `oauth_connections` (per org/company), `credentials` (encrypted, never returned by API), `webhook_endpoints`, `webhook_deliveries`, `tools` (registry mirror), `tool_calls` |
| 5 Execution | `sandboxes`, `sandbox_sessions`, `sandbox_artifacts` |
| 6 Business | `leads`, `deals`, `pipelines`, `pipeline_stages`, `activities`, `meetings`, `campaigns`, `content_items`, `invoices`, `expenses`, `tickets`, `kb_articles` |

Every one of these carries `organization_id` (+ `company_id` where company-owned) and follows §1.

## 5. Indexing & scale notes

* Tenant list queries: `(organization_id, created_at DESC, id)`.
* RBAC lookup: `role_assignments (principal_type, principal_id)` and `(organization_id, scope_type, scope_id)`.
* Price resolution: `prices (plan_id, interval, market_type, market_code)` unique; `price_versions (price_id, effective_from DESC)`.
* Outbox relay: partial index `events (occurred_at) WHERE published_at IS NULL`.
* Monthly range partitioning (by `created_at`/`occurred_at`) for `events`, `audit_logs`,
  `usage_records`, `tool_calls`, `webhook_deliveries` once volume warrants (≥ ~50 M rows).
* `knowledge_chunks.embedding`: HNSW index (`vector_cosine_ops`), always filtered by
  `organization_id, company_id` first (partial/iterative scan) — vector search is never cross-tenant.

## 6. Migrations

* Generated with `prisma migrate dev`, reviewed, committed. Production applies with
  `prisma migrate deploy` in CI/CD before the new web/worker version receives traffic.
* Expand → migrate → contract for breaking changes (no destructive change in the same release that
  stops using a column).
