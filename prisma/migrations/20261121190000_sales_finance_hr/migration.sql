BEGIN;

-- CreateEnum
CREATE TYPE "CrmProspectStatus" AS ENUM ('NEW', 'ADDED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CrmIntelKind" AS ENUM ('ENRICHMENT', 'QUALIFICATION');

-- CreateEnum
CREATE TYPE "CrmOutreachStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrmCadenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmCadenceStepKind" AS ENUM ('EMAIL', 'TASK');

-- CreateEnum
CREATE TYPE "CrmEnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmMeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrHeadcountPlanStatus" AS ENUM ('PLANNED', 'APPROVED', 'HIRING', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrHeadcountPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "hr_interviews" ADD COLUMN     "calendar_error" TEXT,
ADD COLUMN     "calendar_event_id" TEXT,
ADD COLUMN     "calendar_provider" TEXT,
ADD COLUMN     "calendar_synced_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "crm_prospect_searches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "audience" TEXT,
    "provider" TEXT,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_prospect_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_prospects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "search_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT,
    "snippet" TEXT NOT NULL DEFAULT '',
    "published_at" TEXT,
    "status" "CrmProspectStatus" NOT NULL DEFAULT 'NEW',
    "lead_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_intel" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "CrmIntelKind" NOT NULL,
    "lead_id" UUID,
    "account_id" UUID,
    "summary" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "fit_score" INTEGER,
    "provider" TEXT,
    "model" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_outreach_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID,
    "deal_id" UUID,
    "enrollment_id" UUID,
    "step_position" INTEGER,
    "to_email" TEXT NOT NULL,
    "to_name" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CrmOutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "ai_provider" TEXT,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmCadenceStatus" NOT NULL DEFAULT 'DRAFT',
    "auto_send" BOOLEAN NOT NULL DEFAULT false,
    "stop_on_reply" BOOLEAN NOT NULL DEFAULT true,
    "activated_by_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cadence_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "CrmCadenceStepKind" NOT NULL DEFAULT 'EMAIL',
    "delay_days" INTEGER NOT NULL DEFAULT 2,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_cadence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_cadence_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cadence_id" UUID NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID,
    "to_email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CrmEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_step" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMPTZ(3),
    "last_step_at" TIMESTAMPTZ(3),
    "stopped_reason" TEXT,
    "owner_id" UUID,
    "enrolled_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_cadence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meetings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID,
    "account_id" UUID,
    "deal_id" UUID,
    "attendee_email" TEXT,
    "attendee_name" TEXT,
    "status" "CrmMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "calendar_provider" TEXT,
    "external_id" TEXT,
    "invite_sent_at" TIMESTAMPTZ(3),
    "calendar_error" TEXT,
    "outcome" TEXT,
    "organizer_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_alert_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_alert_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_headcount_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" UUID,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "target_start" DATE NOT NULL,
    "annual_cost_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "priority" "HrHeadcountPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "HrHeadcountPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "reason" TEXT,
    "job_id" UUID,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hr_headcount_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_prospect_searches_organization_id_company_id_created_at_idx" ON "crm_prospect_searches"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospect_searches_id_company_id_key" ON "crm_prospect_searches"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_prospects_company_id_status_idx" ON "crm_prospects"("company_id", "status");

-- CreateIndex
CREATE INDEX "crm_prospects_company_id_domain_idx" ON "crm_prospects"("company_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospects_search_id_url_key" ON "crm_prospects"("search_id", "url");

-- CreateIndex
CREATE INDEX "crm_intel_company_id_lead_id_kind_created_at_idx" ON "crm_intel"("company_id", "lead_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "crm_intel_company_id_account_id_kind_created_at_idx" ON "crm_intel"("company_id", "account_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "crm_outreach_messages_organization_id_company_id_status_idx" ON "crm_outreach_messages"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "crm_outreach_messages_company_id_lead_id_idx" ON "crm_outreach_messages"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_outreach_messages_company_id_contact_id_idx" ON "crm_outreach_messages"("company_id", "contact_id");

-- CreateIndex
CREATE INDEX "crm_outreach_messages_company_id_to_email_idx" ON "crm_outreach_messages"("company_id", "to_email");

-- CreateIndex
CREATE UNIQUE INDEX "crm_outreach_messages_id_company_id_key" ON "crm_outreach_messages"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_cadences_organization_id_company_id_status_idx" ON "crm_cadences"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_cadences_id_company_id_key" ON "crm_cadences"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_cadence_steps_cadence_id_position_idx" ON "crm_cadence_steps"("cadence_id", "position");

-- CreateIndex
CREATE INDEX "crm_cadence_enrollments_status_next_run_at_idx" ON "crm_cadence_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "crm_cadence_enrollments_company_id_lead_id_idx" ON "crm_cadence_enrollments"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_cadence_enrollments_company_id_contact_id_idx" ON "crm_cadence_enrollments"("company_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_cadence_enrollments_id_company_id_key" ON "crm_cadence_enrollments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_cadence_enrollments_cadence_id_to_email_key" ON "crm_cadence_enrollments"("cadence_id", "to_email");

-- CreateIndex
CREATE INDEX "crm_meetings_organization_id_company_id_starts_at_idx" ON "crm_meetings"("organization_id", "company_id", "starts_at");

-- CreateIndex
CREATE INDEX "crm_meetings_company_id_lead_id_idx" ON "crm_meetings"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_meetings_company_id_contact_id_idx" ON "crm_meetings"("company_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_meetings_id_company_id_key" ON "crm_meetings"("id", "company_id");

-- CreateIndex
CREATE INDEX "finance_alert_logs_organization_id_company_id_sent_at_idx" ON "finance_alert_logs"("organization_id", "company_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "finance_alert_logs_company_id_kind_period_key_key" ON "finance_alert_logs"("company_id", "kind", "period_key");

-- CreateIndex
CREATE INDEX "hr_headcount_plans_organization_id_company_id_target_start_idx" ON "hr_headcount_plans"("organization_id", "company_id", "target_start");

-- CreateIndex
CREATE UNIQUE INDEX "hr_headcount_plans_id_company_id_key" ON "hr_headcount_plans"("id", "company_id");

-- AddForeignKey
ALTER TABLE "crm_prospect_searches" ADD CONSTRAINT "crm_prospect_searches_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospects" ADD CONSTRAINT "crm_prospects_search_id_company_id_fkey" FOREIGN KEY ("search_id", "company_id") REFERENCES "crm_prospect_searches"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_intel" ADD CONSTRAINT "crm_intel_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_outreach_messages" ADD CONSTRAINT "crm_outreach_messages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_outreach_messages" ADD CONSTRAINT "crm_outreach_messages_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_outreach_messages" ADD CONSTRAINT "crm_outreach_messages_enrollment_id_company_id_fkey" FOREIGN KEY ("enrollment_id", "company_id") REFERENCES "crm_cadence_enrollments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadences" ADD CONSTRAINT "crm_cadences_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_steps" ADD CONSTRAINT "crm_cadence_steps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_steps" ADD CONSTRAINT "crm_cadence_steps_cadence_id_company_id_fkey" FOREIGN KEY ("cadence_id", "company_id") REFERENCES "crm_cadences"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_enrollments" ADD CONSTRAINT "crm_cadence_enrollments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_cadence_enrollments" ADD CONSTRAINT "crm_cadence_enrollments_cadence_id_company_id_fkey" FOREIGN KEY ("cadence_id", "company_id") REFERENCES "crm_cadences"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_alert_logs" ADD CONSTRAINT "finance_alert_logs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_headcount_plans" ADD CONSTRAINT "hr_headcount_plans_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_headcount_plans" ADD CONSTRAINT "hr_headcount_plans_job_id_company_id_fkey" FOREIGN KEY ("job_id", "company_id") REFERENCES "hr_jobs"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;


COMMIT;
