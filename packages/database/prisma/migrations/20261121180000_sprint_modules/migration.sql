BEGIN;

-- CreateEnum
CREATE TYPE "CommandRunStatus" AS ENUM ('PLANNED', 'RUNNING', 'REVIEWING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommandStepKind" AS ENUM ('RESEARCH', 'DEPARTMENT', 'REVIEW');

-- CreateEnum
CREATE TYPE "CommandStepStatus" AS ENUM ('WAITING', 'DELEGATED', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MarketingResearchKind" AS ENUM ('MARKET', 'COMPETITOR', 'AUDIENCE', 'TRENDS', 'KEYWORDS', 'BRAND');

-- CreateEnum
CREATE TYPE "MarketingResearchStatus" AS ENUM ('RESEARCHING', 'SYNTHESIZING', 'READY', 'SOURCES_ONLY', 'CREDENTIAL_REQUIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingPlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingOptimizationStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SiteWaitlistStatus" AS ENUM ('WAITING', 'INVITED', 'JOINED', 'REMOVED');

-- CreateEnum
CREATE TYPE "WorkDeliverableStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkerJobStatus" AS ENUM ('ACTIVE', 'RETRYING', 'SUCCEEDED', 'FAILED', 'DEAD', 'REQUEUED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationHookVerification" ADD VALUE 'STRIPE';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'GITHUB';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'SHOPIFY';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'SLACK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProductDocKind" ADD VALUE 'IDEA_BRIEF';
ALTER TYPE "ProductDocKind" ADD VALUE 'VALIDATION_REPORT';
ALTER TYPE "ProductDocKind" ADD VALUE 'LAUNCH_BRIEF';
ALTER TYPE "ProductDocKind" ADD VALUE 'FEEDBACK_SYNTHESIS';
ALTER TYPE "ProductDocKind" ADD VALUE 'IMPROVEMENT_PLAN';

-- AlterTable
ALTER TABLE "builder_runs" ADD COLUMN     "journey" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "builder_onboarding" ADD COLUMN     "draft" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "journey_stage" TEXT;

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "csat_comment" TEXT,
ADD COLUMN     "csat_rated_at" TIMESTAMPTZ(3),
ADD COLUMN     "csat_score" INTEGER;

-- AlterTable
ALTER TABLE "product_feedback" ADD COLUMN     "support_ticket_id" UUID;

-- CreateTable
CREATE TABLE "command_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "status" "CommandRunStatus" NOT NULL DEFAULT 'PLANNED',
    "understanding" JSONB NOT NULL DEFAULT '{}',
    "next_action" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "command_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_plan_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "CommandStepKind" NOT NULL,
    "intent" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "ai_employee_id" UUID,
    "title" TEXT NOT NULL,
    "focus" TEXT NOT NULL,
    "depends_on" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "CommandStepStatus" NOT NULL DEFAULT 'WAITING',
    "task_id" UUID,
    "error_reason" TEXT,
    "delegated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_reminders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "title" TEXT NOT NULL,
    "note" TEXT,
    "remind_at" TIMESTAMPTZ(3) NOT NULL,
    "href" TEXT,
    "subject_type" TEXT,
    "subject_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comms_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_research_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "MarketingResearchKind" NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "status" "MarketingResearchStatus" NOT NULL DEFAULT 'RESEARCHING',
    "provider" TEXT,
    "queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "findings" JSONB,
    "task_id" UUID,
    "error" TEXT,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketing_research_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MarketingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "positioning" TEXT,
    "audience" TEXT,
    "messaging" TEXT,
    "objectives" JSONB NOT NULL DEFAULT '[]',
    "channels" JSONB NOT NULL DEFAULT '[]',
    "budget_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "research_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draft_task_id" UUID,
    "ai_draft" JSONB,
    "draft_error" TEXT,
    "goal_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "campaign_id" UUID,
    "review_note" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_optimizations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "action" JSONB NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'rules',
    "status" "MarketingOptimizationStatus" NOT NULL DEFAULT 'PROPOSED',
    "entity_type" TEXT,
    "entity_id" UUID,
    "dedupe_key" TEXT,
    "task_id" UUID,
    "result" JSONB,
    "error" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketing_optimizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_waitlist_entries" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "role" TEXT,
    "team_size" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "source" TEXT,
    "status" "SiteWaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "consent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_project_deliverables" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "milestone_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkDeliverableStatus" NOT NULL DEFAULT 'PLANNED',
    "owner_id" UUID,
    "due_date" DATE,
    "url" TEXT,
    "review_note" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_project_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_job_runs" (
    "id" UUID NOT NULL,
    "queue" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "organization_id" UUID,
    "status" "WorkerJobStatus" NOT NULL DEFAULT 'ACTIVE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT,
    "logs" JSONB NOT NULL DEFAULT '[]',
    "result" INTEGER,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "worker_id" TEXT,
    "dead_lettered_at" TIMESTAMPTZ(3),
    "requeued_at" TIMESTAMPTZ(3),
    "requeued_by_id" UUID,
    "requeue_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "command_runs_organization_id_company_id_status_updated_at_idx" ON "command_runs"("organization_id", "company_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "command_runs_session_id_created_at_idx" ON "command_runs"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "command_runs_id_company_id_key" ON "command_runs"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "command_runs_message_id_key" ON "command_runs"("message_id");

-- CreateIndex
CREATE INDEX "command_plan_steps_task_id_idx" ON "command_plan_steps"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "command_plan_steps_run_id_position_key" ON "command_plan_steps"("run_id", "position");

-- CreateIndex
CREATE INDEX "comms_reminders_sent_at_remind_at_idx" ON "comms_reminders"("sent_at", "remind_at");

-- CreateIndex
CREATE INDEX "comms_reminders_organization_id_company_id_user_id_remind_a_idx" ON "comms_reminders"("organization_id", "company_id", "user_id", "remind_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_reminders_user_id_kind_subject_id_remind_at_key" ON "comms_reminders"("user_id", "kind", "subject_id", "remind_at");

-- CreateIndex
CREATE INDEX "marketing_research_reports_company_id_kind_created_at_idx" ON "marketing_research_reports"("company_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "marketing_research_reports_status_updated_at_idx" ON "marketing_research_reports"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_research_reports_id_company_id_key" ON "marketing_research_reports"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_plans_company_id_status_idx" ON "marketing_plans"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_plans_id_company_id_key" ON "marketing_plans"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_optimizations_company_id_status_created_at_idx" ON "marketing_optimizations"("company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_optimizations_id_company_id_key" ON "marketing_optimizations"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_optimizations_company_id_dedupe_key_key" ON "marketing_optimizations"("company_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "site_waitlist_entries_email_key" ON "site_waitlist_entries"("email");

-- CreateIndex
CREATE INDEX "site_waitlist_entries_status_created_at_idx" ON "site_waitlist_entries"("status", "created_at");

-- CreateIndex
CREATE INDEX "work_project_deliverables_project_id_due_date_idx" ON "work_project_deliverables"("project_id", "due_date");

-- CreateIndex
CREATE INDEX "work_project_deliverables_company_id_owner_id_idx" ON "work_project_deliverables"("company_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_project_deliverables_id_company_id_key" ON "work_project_deliverables"("id", "company_id");

-- CreateIndex
CREATE INDEX "worker_job_runs_status_updated_at_idx" ON "worker_job_runs"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "worker_job_runs_queue_created_at_idx" ON "worker_job_runs"("queue", "created_at" DESC);

-- CreateIndex
CREATE INDEX "worker_job_runs_organization_id_created_at_idx" ON "worker_job_runs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "worker_job_runs_queue_job_id_key" ON "worker_job_runs"("queue", "job_id");

-- CreateIndex
CREATE INDEX "product_feedback_support_ticket_id_idx" ON "product_feedback"("support_ticket_id");

-- AddForeignKey
ALTER TABLE "command_runs" ADD CONSTRAINT "command_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_runs" ADD CONSTRAINT "command_runs_session_id_company_id_fkey" FOREIGN KEY ("session_id", "company_id") REFERENCES "command_sessions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_plan_steps" ADD CONSTRAINT "command_plan_steps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_plan_steps" ADD CONSTRAINT "command_plan_steps_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "command_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_reminders" ADD CONSTRAINT "comms_reminders_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_research_reports" ADD CONSTRAINT "marketing_research_reports_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_plans" ADD CONSTRAINT "marketing_plans_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_optimizations" ADD CONSTRAINT "marketing_optimizations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_project_deliverables" ADD CONSTRAINT "work_project_deliverables_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_project_deliverables" ADD CONSTRAINT "work_project_deliverables_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
