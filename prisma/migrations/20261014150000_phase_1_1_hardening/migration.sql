-- Atomic: Prisma does not wrap a migration in a transaction, and a failure part-way (e.g. existing data
-- violating a new constraint) would otherwise leave a half-applied schema. With BEGIN/COMMIT a failure rolls
-- everything back; fix the data, run `prisma migrate resolve --rolled-back <this migration>`, deploy again.
-- (ALTER TYPE ... ADD VALUE is allowed in a transaction on PostgreSQL 12+; new values are not used here.)
BEGIN;

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED', 'NOT_CONFIGURED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'INCOMPLETE_EXPIRED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAUSED';

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_company_id_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_items" DROP CONSTRAINT "subscription_items_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_company_id_fkey";

-- idempotency_keys was never written by Phase 1 code; clear defensively before adding NOT NULL "endpoint".
DELETE FROM "idempotency_keys";

-- DropIndex
DROP INDEX "idempotency_keys_principal_id_key_key";

-- AlterTable
ALTER TABLE "idempotency_keys" ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "endpoint" TEXT NOT NULL,
ADD COLUMN     "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
ALTER COLUMN "response_status" DROP NOT NULL,
ALTER COLUMN "response_body" DROP NOT NULL;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "delivery_status" "EmailStatus",
ADD COLUMN     "last_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "send_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "oauth_accounts" ADD COLUMN     "last_login_at" TIMESTAMPTZ(3),
ADD COLUMN     "provider_email" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "stripe_product_id" TEXT;

-- AlterTable
ALTER TABLE "promotions" ADD COLUMN     "stripe_coupon_id" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "subscription_items" ADD COLUMN     "stripe_subscription_item_id" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canceled_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_payment_failed_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_payment_succeeded_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "to_email" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "organization_id" UUID,
    "outcome" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_messages_organization_id_created_at_idx" ON "email_messages"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "stripe_events_type_processed_at_idx" ON "stripe_events"("type", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_id_organization_id_key" ON "companies"("id", "organization_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_principal_id_endpoint_key_key" ON "idempotency_keys"("principal_id", "endpoint", "key");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_user_id_provider_key" ON "oauth_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripe_product_id_key" ON "plans"("stripe_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_stripe_coupon_id_key" ON "promotions"("stripe_coupon_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_items_stripe_subscription_item_id_key" ON "subscription_items"("stripe_subscription_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_id_organization_id_key" ON "subscriptions"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_id_organization_id_key" ON "workspaces"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_organization_id_fkey" FOREIGN KEY ("workspace_id", "organization_id") REFERENCES "workspaces"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_organization_id_fkey" FOREIGN KEY ("subscription_id", "organization_id") REFERENCES "subscriptions"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
