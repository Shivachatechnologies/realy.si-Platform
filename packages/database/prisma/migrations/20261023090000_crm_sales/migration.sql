-- CRM sales execution: lead owner, deal fields, activity timeline, follow-up priority, AI task ↔ lead. Additive only.
BEGIN;
-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'NOTE');

-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "lead_id" UUID;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "expected_close_date" DATE,
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "probability" INTEGER;

-- AlterTable
ALTER TABLE "lead_follow_ups" ADD COLUMN     "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM';

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_occurred_at_idx" ON "lead_activities"("lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "lead_activities_organization_id_company_id_occurred_at_idx" ON "lead_activities"("organization_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "agent_tasks_lead_id_idx" ON "agent_tasks"("lead_id");

-- CreateIndex
CREATE INDEX "leads_organization_id_company_id_owner_id_idx" ON "leads"("organization_id", "company_id", "owner_id");

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "leads"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "leads"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants the application also enforces.
ALTER TABLE "leads" ADD CONSTRAINT "leads_probability_range" CHECK ("probability" IS NULL OR "probability" BETWEEN 0 AND 100);
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_summary_not_blank" CHECK (length(btrim("summary")) BETWEEN 1 AND 5000);

COMMIT;
