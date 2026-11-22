-- CreateEnum
CREATE TYPE "ImpersonationMode" AS ENUM ('READ_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "AccessReviewStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AccessReviewDecision" AS ENUM ('KEEP', 'REVOKE');

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_DELETION';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "closed_reason" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "impersonation_id" UUID,
ADD COLUMN     "impersonator_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "deletion_scheduled_for" TIMESTAMPTZ(3),
ADD COLUMN     "restrictions" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "admin_impersonations" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "organization_id" UUID,
    "mode" "ImpersonationMode" NOT NULL DEFAULT 'READ_ONLY',
    "reason" TEXT NOT NULL,
    "ticket_ref" TEXT,
    "token_hash" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "redeemed_at" TIMESTAMPTZ(3),
    "session_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" TEXT,
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "admin_impersonations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_access_reviews" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AccessReviewStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_access_review_items" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "decision" "AccessReviewDecision",
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "platform_access_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_impersonations_token_hash_key" ON "admin_impersonations"("token_hash");

-- CreateIndex
CREATE INDEX "admin_impersonations_admin_user_id_started_at_idx" ON "admin_impersonations"("admin_user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "admin_impersonations_target_user_id_started_at_idx" ON "admin_impersonations"("target_user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "admin_impersonations_ended_at_expires_at_idx" ON "admin_impersonations"("ended_at", "expires_at");

-- CreateIndex
CREATE INDEX "platform_access_reviews_status_created_at_idx" ON "platform_access_reviews"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_access_review_items_principal_id_idx" ON "platform_access_review_items"("principal_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_access_review_items_review_id_assignment_id_key" ON "platform_access_review_items"("review_id", "assignment_id");

-- CreateIndex
CREATE INDEX "sessions_impersonation_id_idx" ON "sessions"("impersonation_id");

-- CreateIndex
CREATE INDEX "users_status_deletion_scheduled_for_idx" ON "users"("status", "deletion_scheduled_for");

-- AddForeignKey
ALTER TABLE "platform_access_review_items" ADD CONSTRAINT "platform_access_review_items_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "platform_access_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

