-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "MfaFactorType" AS ENUM ('TOTP', 'WEBAUTHN');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompanyStage" AS ENUM ('IDEA', 'FORMING', 'BUILDING', 'LAUNCHED', 'SCALING');

-- CreateEnum
CREATE TYPE "DataRegion" AS ENUM ('us-east', 'eu-west', 'me-central', 'ap-south', 'ap-southeast');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('USER', 'SERVICE_ACCOUNT', 'AGENT');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SERVICE_ACCOUNT', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('PLATFORM', 'REGION', 'COUNTRY', 'ORGANIZATION', 'COMPANY', 'WORKSPACE', 'PROJECT');

-- CreateEnum
CREATE TYPE "TextDirection" AS ENUM ('LTR', 'RTL');

-- CreateEnum
CREATE TYPE "ConfigStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'GST', 'SALES_TAX', 'DIGITAL_SERVICES_TAX', 'NONE');

-- CreateEnum
CREATE TYPE "TaxCalculation" AS ENUM ('STRIPE_TAX', 'MANUAL');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('GLOBAL', 'REGION', 'COUNTRY');

-- CreateEnum
CREATE TYPE "UsageType" AS ENUM ('LICENSED', 'SEAT', 'METERED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "FlagTargetType" AS ENUM ('GLOBAL', 'REGION', 'COUNTRY', 'PLAN', 'ORGANIZATION', 'COMPANY', 'USER');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('TENANT', 'ADMIN', 'SECURITY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "country_code" CHAR(2),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mfa_pending" BOOLEAN NOT NULL DEFAULT false,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "active_organization_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "MfaFactorType" NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "last_used_step" BIGINT,
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "default_locale" TEXT NOT NULL DEFAULT 'en-US',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "ScopeType" NOT NULL DEFAULT 'ORGANIZATION',
    "scope_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "service_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "slug" TEXT NOT NULL,
    "stage" "CompanyStage" NOT NULL DEFAULT 'IDEA',
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "incorporation_country_code" CHAR(2),
    "operating_country_codes" TEXT[],
    "target_market_codes" TEXT[],
    "base_currency" CHAR(3) NOT NULL,
    "default_locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "data_region" "DataRegion" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "platform_only" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "assignable_at" "ScopeType"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "principal_type" "PrincipalType" NOT NULL,
    "principal_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "organization_id" UUID,
    "granted_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_currency" CHAR(3) NOT NULL,
    "default_locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "data_region" "DataRegion" NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "region_code" TEXT NOT NULL,
    "default_locale" TEXT NOT NULL,
    "supported_locales" TEXT[],
    "default_currency" CHAR(3) NOT NULL,
    "supported_currencies" TEXT[],
    "default_timezone" TEXT NOT NULL,
    "billing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment_methods" TEXT[],
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minor_units" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "locales" (
    "tag" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native_name" TEXT NOT NULL,
    "direction" "TextDirection" NOT NULL DEFAULT 'LTR',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "fallback_tag" TEXT,

    CONSTRAINT "locales_pkey" PRIMARY KEY ("tag")
);

-- CreateTable
CREATE TABLE "tax_configs" (
    "id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "subdivision" TEXT,
    "tax_type" "TaxType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "price_includes_tax" BOOLEAN NOT NULL DEFAULT false,
    "calculation" "TaxCalculation" NOT NULL DEFAULT 'STRIPE_TAX',
    "reverse_charge_b2b" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_products" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "default_trial_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "market_type" "MarketType" NOT NULL,
    "market_code" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "usage_type" "UsageType" NOT NULL DEFAULT 'LICENSED',
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_versions" (
    "id" UUID NOT NULL,
    "price_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "trial_days" INTEGER,
    "stripe_price_id" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" BIGINT,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "percent_off_bps" INTEGER,
    "amount_off_minor" BIGINT,
    "currency" CHAR(3),
    "plan_keys" TEXT[],
    "country_codes" TEXT[],
    "region_codes" TEXT[],
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "max_redemptions" INTEGER,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "billing_country_code" CHAR(2) NOT NULL,
    "billing_country_confirmed_at" TIMESTAMPTZ(3),
    "currency" CHAR(3) NOT NULL,
    "legal_name" TEXT,
    "tax_ids" JSONB NOT NULL DEFAULT '[]',
    "address" JSONB NOT NULL DEFAULT '{}',
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_country_code" CHAR(2) NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "cancel_at" TIMESTAMPTZ(3),
    "stripe_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "price_version_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID,
    "meter" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "default_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag_rules" (
    "id" UUID NOT NULL,
    "flag_id" UUID NOT NULL,
    "target_type" "FlagTargetType" NOT NULL,
    "target_value" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "organization_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "organization_id" UUID,
    "company_id" UUID,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "request_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "principal_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_idx" ON "mfa_factors"("user_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_created_at_idx" ON "invitations"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "service_accounts_organization_id_idx" ON "service_accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys"("organization_id");

-- CreateIndex
CREATE INDEX "companies_organization_id_created_at_idx" ON "companies"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organization_id_slug_key" ON "companies"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "workspaces_organization_id_company_id_idx" ON "workspaces"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_organization_id_company_id_slug_key" ON "workspaces"("organization_id", "company_id", "slug");

-- CreateIndex
CREATE INDEX "projects_organization_id_company_id_workspace_id_idx" ON "projects"("organization_id", "company_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE INDEX "role_assignments_principal_type_principal_id_idx" ON "role_assignments"("principal_type", "principal_id");

-- CreateIndex
CREATE INDEX "role_assignments_organization_id_scope_type_scope_id_idx" ON "role_assignments"("organization_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_principal_type_principal_id_role_id_scope__key" ON "role_assignments"("principal_type", "principal_id", "role_id", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "countries_region_code_idx" ON "countries"("region_code");

-- CreateIndex
CREATE INDEX "tax_configs_country_code_status_idx" ON "tax_configs"("country_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_products_key_key" ON "billing_products"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "prices_plan_id_interval_market_type_market_code_key" ON "prices"("plan_id", "interval", "market_type", "market_code");

-- CreateIndex
CREATE UNIQUE INDEX "price_versions_stripe_price_id_key" ON "price_versions"("stripe_price_id");

-- CreateIndex
CREATE INDEX "price_versions_price_id_effective_from_idx" ON "price_versions"("price_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "price_versions_price_id_version_key" ON "price_versions"("price_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlements_plan_id_feature_key_key" ON "plan_entitlements"("plan_id", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_organization_id_key" ON "billing_profiles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_stripe_customer_id_key" ON "billing_profiles"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_organization_id_status_idx" ON "subscriptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "subscription_items_organization_id_idx" ON "subscription_items"("organization_id");

-- CreateIndex
CREATE INDEX "subscription_items_price_version_id_idx" ON "subscription_items"("price_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_idempotency_key_key" ON "usage_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "usage_records_organization_id_meter_occurred_at_idx" ON "usage_records"("organization_id", "meter", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_rules_flag_id_target_type_target_value_key" ON "feature_flag_rules"("flag_id", "target_type", "target_value");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_category_created_at_idx" ON "audit_logs"("category", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "events_organization_id_occurred_at_idx" ON "events"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "events_type_occurred_at_idx" ON "events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_user_id_created_at_idx" ON "notifications"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_principal_id_key_key" ON "idempotency_keys"("principal_id", "key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_account_id_fkey" FOREIGN KEY ("service_account_id") REFERENCES "service_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_configs" ADD CONSTRAINT "tax_configs_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "billing_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_price_version_id_fkey" FOREIGN KEY ("price_version_id") REFERENCES "price_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flag_rules" ADD CONSTRAINT "feature_flag_rules_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Realy invariants not expressible in Prisma schema (docs/database.md) ─────────────

CREATE EXTENSION IF NOT EXISTS vector;   -- used from Phase 2 (knowledge_chunks)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- System role keys are unique among system roles (organization_id IS NULL).
CREATE UNIQUE INDEX "roles_system_key_key" ON "roles"("key") WHERE "organization_id" IS NULL;

-- Outbox relay scans only unpublished events.
CREATE INDEX "events_unpublished_idx" ON "events"("occurred_at") WHERE "published_at" IS NULL;

-- Money and time sanity.
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_amount_nonneg" CHECK ("amount_minor" >= 0);
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_valid_window"
  CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_amount_nonneg" CHECK ("unit_amount_minor" >= 0);
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "tax_configs" ADD CONSTRAINT "tax_configs_rate_range" CHECK ("rate_bps" >= 0 AND "rate_bps" <= 10000);
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_percent_range"
  CHECK ("percent_off_bps" IS NULL OR ("percent_off_bps" > 0 AND "percent_off_bps" <= 10000));

-- Versions of one price never overlap in time.
ALTER TABLE "price_versions" ADD CONSTRAINT "price_versions_no_overlap"
  EXCLUDE USING gist ("price_id" WITH =, tstzrange("effective_from", "effective_to", '[)') WITH &&);

-- Price history is immutable: only effective_to (end-dating) and stripe_price_id may change.
CREATE FUNCTION realy_price_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'price_versions are append-only (delete refused for %)', OLD.id;
  END IF;
  IF NEW.price_id IS DISTINCT FROM OLD.price_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.trial_days IS DISTINCT FROM OLD.trial_days THEN
    RAISE EXCEPTION 'price_versions are immutable; create a new version instead (id %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "price_versions_immutable"
  BEFORE UPDATE OR DELETE ON "price_versions"
  FOR EACH ROW EXECUTE FUNCTION realy_price_versions_immutable();

-- Audit logs are append-only.
CREATE FUNCTION realy_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION realy_audit_logs_append_only();
