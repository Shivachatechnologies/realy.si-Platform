-- CRM leads and follow-ups. Additive only. Atomic, see 20261015120000_checkout_sessions.
BEGIN;

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadScoreLabel" AS ENUM ('HOT', 'WARM', 'NURTURE');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "email_normalized" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "account" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "value_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "score" INTEGER NOT NULL,
    "score_label" "LeadScoreLabel" NOT NULL,
    "last_contacted_at" TIMESTAMPTZ(3),
    "merged_into_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_organization_id_company_id_stage_idx" ON "leads"("organization_id", "company_id", "stage");

-- CreateIndex
CREATE INDEX "leads_company_id_email_normalized_idx" ON "leads"("company_id", "email_normalized");

-- CreateIndex
CREATE INDEX "leads_company_id_phone_normalized_idx" ON "leads"("company_id", "phone_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "leads_id_company_id_key" ON "leads"("id", "company_id");

-- CreateIndex
CREATE INDEX "lead_follow_ups_company_id_completed_at_due_at_idx" ON "lead_follow_ups"("company_id", "completed_at", "due_at");

-- CreateIndex
CREATE INDEX "lead_follow_ups_lead_id_idx" ON "lead_follow_ups"("lead_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "leads"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants the application also enforces.
ALTER TABLE "leads" ADD CONSTRAINT "leads_name_not_blank" CHECK (length(btrim("name")) BETWEEN 1 AND 200);
ALTER TABLE "leads" ADD CONSTRAINT "leads_score_range" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "leads" ADD CONSTRAINT "leads_value_non_negative" CHECK ("value_minor" IS NULL OR "value_minor" >= 0);
ALTER TABLE "leads" ADD CONSTRAINT "leads_not_merged_into_self" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_note_not_blank" CHECK (length(btrim("note")) BETWEEN 1 AND 1000);

COMMIT;
