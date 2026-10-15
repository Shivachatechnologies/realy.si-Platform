-- Atomic: Prisma does not wrap a migration in a transaction, and a failure part-way (e.g. existing data
-- violating a new constraint) would otherwise leave a half-applied schema. With BEGIN/COMMIT a failure rolls
-- everything back; fix the data, run `prisma migrate resolve --rolled-back <this migration>`, deploy again.
-- (ALTER TYPE ... ADD VALUE is allowed in a transaction on PostgreSQL 12+; new values are not used here.)
BEGIN;

-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'OPEN',
    "stripe_session_id" TEXT,
    "url" TEXT,
    "price_version_id" UUID NOT NULL,
    "coupon_code" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_stripe_session_id_key" ON "checkout_sessions"("stripe_session_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_organization_id_status_idx" ON "checkout_sessions"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Double-billing protection (database-level, not only application code).
-- 1. At most one OPEN checkout session per organization: concurrent checkout requests race on this index
--    and exactly one wins. Prisma cannot declare partial indexes, so they live here (like roles_system_key_key).
CREATE UNIQUE INDEX "checkout_sessions_one_open_per_org" ON "checkout_sessions"("organization_id") WHERE "status" = 'OPEN';

-- 2. At most one live subscription per organization. Statuses must match LIVE_STATUSES in
--    src/server/modules/billing/stripe-billing.ts. Fails (and the migration rolls back) if existing data
--    already has two live subscriptions for one organization — run the pre-check in the Phase 1.1 report.
CREATE UNIQUE INDEX "subscriptions_one_live_per_org" ON "subscriptions"("organization_id")
  WHERE "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'INCOMPLETE', 'UNPAID', 'PAUSED');

COMMIT;
