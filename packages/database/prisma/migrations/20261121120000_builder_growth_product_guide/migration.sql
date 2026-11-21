-- Company Builder, AI workforce hierarchy + CEO chat + growth engine, Product Studio, AI guide + command workspace.
-- Additive, except one index swap: release versions become unique per product instead of per company (no data change).
BEGIN;


-- CreateEnum
CREATE TYPE "BuilderRunMode" AS ENUM ('NEW_IDEA', 'EXISTING', 'IMPORT');

-- CreateEnum
CREATE TYPE "BuilderRunStatus" AS ENUM ('DRAFT', 'RUNNING', 'WAITING_INPUT', 'FAILED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BuilderStepStatus" AS ENUM ('PENDING', 'RUNNING', 'APPLYING', 'WAITING_INPUT', 'COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BuilderDecisionStatus" AS ENUM ('OPEN', 'DECIDED');

-- CreateEnum
CREATE TYPE "BuilderSourceStatus" AS ENUM ('INGESTED', 'FAILED');

-- CreateEnum
CREATE TYPE "GrowthAutonomy" AS ENUM ('OBSERVE', 'RECOMMEND', 'PREPARE', 'EXECUTE_WITH_APPROVAL');

-- CreateEnum
CREATE TYPE "GrowthSignal" AS ENUM ('NO_CUSTOMERS', 'LOW_CONVERSION', 'REVENUE_DECLINE', 'PROJECTS_DELAYED', 'COMPLAINTS_UP', 'STRONG_CAMPAIGN', 'DECISION_OVERLOAD');

-- CreateEnum
CREATE TYPE "GrowthSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "GrowthInsightStatus" AS ENUM ('OPEN', 'ACTED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "GuideRequestKind" AS ENUM ('EXPLAIN', 'GUIDE', 'NEXT', 'RECOMMEND', 'ASK', 'DO');

-- CreateEnum
CREATE TYPE "CommandMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ProductStage" AS ENUM ('IDEA', 'RESEARCH', 'VALIDATION', 'BUSINESS_REQUIREMENTS', 'PRODUCT_REQUIREMENTS', 'ARCHITECTURE', 'DESIGN', 'DEVELOPMENT', 'QA', 'RELEASE', 'LAUNCH', 'FEEDBACK', 'OPTIMIZATION');

-- CreateEnum
CREATE TYPE "ProductLifecycleStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'SUNSET');

-- CreateEnum
CREATE TYPE "ProductValidationKind" AS ENUM ('INTERVIEW', 'SURVEY', 'EXPERIMENT', 'MARKET_DATA', 'PREORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductValidationResult" AS ENUM ('PENDING', 'VALIDATED', 'INVALIDATED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "ProductDocKind" AS ENUM ('RESEARCH', 'BRD', 'PRD', 'TECH_REQUIREMENTS', 'ARCHITECTURE', 'UX_SPEC', 'DESIGN_BRIEF', 'QA_PLAN', 'RELEASE_PLAN');

-- CreateEnum
CREATE TYPE "ProductDocStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED');

-- CreateEnum
CREATE TYPE "ProductPlanStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductFeedbackSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "AiOrgLevel" AS ENUM ('EXECUTIVE', 'MANAGER', 'SPECIALIST');

-- CreateEnum
CREATE TYPE "AiReportKind" AS ENUM ('STATUS', 'ESCALATION');

-- CreateEnum
CREATE TYPE "CeoMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- DropIndex
DROP INDEX "product_releases_company_id_version_key";

-- AlterTable
ALTER TABLE "product_initiatives" ADD COLUMN     "product_id" UUID;

-- AlterTable
ALTER TABLE "product_features" ADD COLUMN     "acceptance_criteria" TEXT,
ADD COLUMN     "product_id" UUID,
ADD COLUMN     "requirements" TEXT;

-- AlterTable
ALTER TABLE "product_ideas" ADD COLUMN     "product_id" UUID;

-- AlterTable
ALTER TABLE "product_feedback" ADD COLUMN     "product_id" UUID,
ADD COLUMN     "sentiment" "ProductFeedbackSentiment";

-- AlterTable
ALTER TABLE "product_releases" ADD COLUMN     "product_id" UUID;

-- AlterTable
ALTER TABLE "ai_employees" ADD COLUMN     "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "job_description" TEXT,
ADD COLUMN     "job_title" TEXT,
ADD COLUMN     "kpis" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "level" "AiOrgLevel" NOT NULL DEFAULT 'SPECIALIST',
ADD COLUMN     "manager_employee_id" UUID,
ADD COLUMN     "manager_user_id" UUID,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "setup_completed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ai_briefings" ADD COLUMN     "sections" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "builder_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mode" "BuilderRunMode" NOT NULL,
    "status" "BuilderRunStatus" NOT NULL DEFAULT 'DRAFT',
    "brief" JSONB NOT NULL,
    "website_url" TEXT,
    "installation_id" UUID,
    "error_message" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "builder_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builder_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "BuilderStepStatus" NOT NULL DEFAULT 'PENDING',
    "profile" TEXT,
    "agent_task_id" UUID,
    "brain_document_id" UUID,
    "data" JSONB,
    "result" JSONB,
    "feedback" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "error_issues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "builder_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builder_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "BuilderDecisionStatus" NOT NULL DEFAULT 'OPEN',
    "options" JSONB NOT NULL,
    "choice" JSONB,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "builder_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builder_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "status" "BuilderSourceStatus" NOT NULL,
    "brain_document_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "builder_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builder_onboarding" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "wizard_step" TEXT,
    "done" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "run_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "builder_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autonomy" "GrowthAutonomy" NOT NULL DEFAULT 'RECOMMEND',
    "decision_threshold" INTEGER NOT NULL DEFAULT 10,
    "last_evaluated_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "growth_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_insights" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "signal" "GrowthSignal" NOT NULL,
    "severity" "GrowthSeverity" NOT NULL,
    "status" "GrowthInsightStatus" NOT NULL DEFAULT 'OPEN',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "week_key" TEXT NOT NULL,
    "autonomy" "GrowthAutonomy" NOT NULL,
    "ai_employee_id" UUID,
    "task_id" UUID,
    "note" TEXT,
    "acted_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "growth_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_progress" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "page_key" TEXT NOT NULL,
    "completed_steps" TEXT[],
    "current_step" TEXT,
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "guide_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "GuideRequestKind" NOT NULL,
    "page_key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "step_key" TEXT,
    "question" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "profile" TEXT NOT NULL,
    "task_id" UUID,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guide_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "command_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "CommandMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "profile" TEXT,
    "ai_employee_id" UUID,
    "task_id" UUID,
    "error_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "command_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target_users" TEXT,
    "status" "ProductLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" UUID,
    "stage" "ProductStage" NOT NULL DEFAULT 'IDEA',
    "stage_entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graph_entity_id" UUID,
    "development_project_id" UUID,
    "launch_campaign_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stage_gates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stage" "ProductStage" NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_stage_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stage_changes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "from_stage" "ProductStage",
    "stage" "ProductStage" NOT NULL,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exited_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "changed_by_id" UUID NOT NULL,
    CONSTRAINT "product_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_competitors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "notes" TEXT,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_validations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "ProductValidationKind" NOT NULL DEFAULT 'INTERVIEW',
    "hypothesis" TEXT NOT NULL,
    "evidence" TEXT,
    "result" "ProductValidationResult" NOT NULL DEFAULT 'PENDING',
    "sample_size" INTEGER,
    "source_url" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_personas" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "description" TEXT,
    "goals" TEXT,
    "pain_points" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_docs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "ProductDocKind" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProductDocStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "brain_document_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_doc_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "agent_task_id" UUID,
    "change_note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_doc_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_plan_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "status" "ProductPlanStatus" NOT NULL DEFAULT 'RUNNING',
    "brief" TEXT,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "product_plan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_employee_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ai_employee_id" UUID NOT NULL,
    "manager_employee_id" UUID,
    "manager_user_id" UUID,
    "kind" "AiReportKind" NOT NULL DEFAULT 'STATUS',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "task_id" UUID,
    "escalation_task_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_employee_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "ceo_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "CeoMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "task_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ceo_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "builder_runs_organization_id_company_id_created_at_idx" ON "builder_runs"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "builder_runs_status_idx" ON "builder_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "builder_runs_id_company_id_key" ON "builder_runs"("id", "company_id");

-- CreateIndex
CREATE INDEX "builder_steps_agent_task_id_idx" ON "builder_steps"("agent_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "builder_steps_run_id_key_key" ON "builder_steps"("run_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "builder_steps_id_company_id_key" ON "builder_steps"("id", "company_id");

-- CreateIndex
CREATE INDEX "builder_decisions_run_id_status_idx" ON "builder_decisions"("run_id", "status");

-- CreateIndex
CREATE INDEX "builder_sources_run_id_idx" ON "builder_sources"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "builder_onboarding_user_id_key" ON "builder_onboarding"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "growth_settings_company_id_key" ON "growth_settings"("company_id");

-- CreateIndex
CREATE INDEX "growth_insights_organization_id_company_id_status_created_a_idx" ON "growth_insights"("organization_id", "company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "growth_insights_company_id_signal_week_key_key" ON "growth_insights"("company_id", "signal", "week_key");

-- CreateIndex
CREATE INDEX "guide_progress_organization_id_company_id_user_id_idx" ON "guide_progress"("organization_id", "company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "guide_progress_company_id_user_id_page_key_key" ON "guide_progress"("company_id", "user_id", "page_key");

-- CreateIndex
CREATE INDEX "guide_requests_organization_id_company_id_user_id_page_key__idx" ON "guide_requests"("organization_id", "company_id", "user_id", "page_key", "created_at");

-- CreateIndex
CREATE INDEX "guide_requests_task_id_idx" ON "guide_requests"("task_id");

-- CreateIndex
CREATE INDEX "command_sessions_organization_id_company_id_user_id_updated_idx" ON "command_sessions"("organization_id", "company_id", "user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "command_sessions_id_company_id_key" ON "command_sessions"("id", "company_id");

-- CreateIndex
CREATE INDEX "command_messages_session_id_created_at_idx" ON "command_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "command_messages_task_id_idx" ON "command_messages"("task_id");

-- CreateIndex
CREATE INDEX "products_company_id_stage_idx" ON "products"("company_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_company_id_key" ON "products"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_name_key" ON "products"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_stage_gates_product_id_stage_key" ON "product_stage_gates"("product_id", "stage");

-- CreateIndex
CREATE INDEX "product_stage_changes_product_id_entered_at_idx" ON "product_stage_changes"("product_id", "entered_at");

-- CreateIndex
CREATE INDEX "product_stage_changes_company_id_exited_at_idx" ON "product_stage_changes"("company_id", "exited_at");

-- CreateIndex
CREATE INDEX "product_competitors_product_id_idx" ON "product_competitors"("product_id");

-- CreateIndex
CREATE INDEX "product_validations_product_id_created_at_idx" ON "product_validations"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "product_personas_product_id_idx" ON "product_personas"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_docs_id_company_id_key" ON "product_docs"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_docs_product_id_kind_key" ON "product_docs"("product_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "product_doc_versions_doc_id_version_key" ON "product_doc_versions"("doc_id", "version");

-- CreateIndex
CREATE INDEX "product_plan_runs_status_idx" ON "product_plan_runs"("status");

-- CreateIndex
CREATE INDEX "product_plan_runs_product_id_created_at_idx" ON "product_plan_runs"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_employee_reports_organization_id_company_id_created_at_idx" ON "ai_employee_reports"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_employee_reports_manager_employee_id_created_at_idx" ON "ai_employee_reports"("manager_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_employee_reports_ai_employee_id_created_at_idx" ON "ai_employee_reports"("ai_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "ceo_conversations_organization_id_company_id_created_by_id__idx" ON "ceo_conversations"("organization_id", "company_id", "created_by_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ceo_conversations_id_company_id_key" ON "ceo_conversations"("id", "company_id");

-- CreateIndex
CREATE INDEX "ceo_messages_conversation_id_created_at_idx" ON "ceo_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ceo_messages_task_id_idx" ON "ceo_messages"("task_id");

-- CreateIndex
CREATE INDEX "product_feedback_product_id_created_at_idx" ON "product_feedback"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_releases_company_id_product_id_version_key" ON "product_releases"("company_id", "product_id", "version");

-- CreateIndex
CREATE INDEX "ai_employees_manager_employee_id_idx" ON "ai_employees"("manager_employee_id");

-- AddForeignKey
ALTER TABLE "builder_runs" ADD CONSTRAINT "builder_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_steps" ADD CONSTRAINT "builder_steps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_steps" ADD CONSTRAINT "builder_steps_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "builder_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_decisions" ADD CONSTRAINT "builder_decisions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_decisions" ADD CONSTRAINT "builder_decisions_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "builder_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_sources" ADD CONSTRAINT "builder_sources_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_sources" ADD CONSTRAINT "builder_sources_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "builder_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_onboarding" ADD CONSTRAINT "builder_onboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_settings" ADD CONSTRAINT "growth_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_insights" ADD CONSTRAINT "growth_insights_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_progress" ADD CONSTRAINT "guide_progress_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_progress" ADD CONSTRAINT "guide_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_requests" ADD CONSTRAINT "guide_requests_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_requests" ADD CONSTRAINT "guide_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_sessions" ADD CONSTRAINT "command_sessions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_sessions" ADD CONSTRAINT "command_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_messages" ADD CONSTRAINT "command_messages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_messages" ADD CONSTRAINT "command_messages_session_id_company_id_fkey" FOREIGN KEY ("session_id", "company_id") REFERENCES "command_sessions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_development_project_id_company_id_fkey" FOREIGN KEY ("development_project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_gates" ADD CONSTRAINT "product_stage_gates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_gates" ADD CONSTRAINT "product_stage_gates_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_changes" ADD CONSTRAINT "product_stage_changes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stage_changes" ADD CONSTRAINT "product_stage_changes_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_competitors" ADD CONSTRAINT "product_competitors_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_competitors" ADD CONSTRAINT "product_competitors_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_validations" ADD CONSTRAINT "product_validations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_validations" ADD CONSTRAINT "product_validations_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_personas" ADD CONSTRAINT "product_personas_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_personas" ADD CONSTRAINT "product_personas_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_docs" ADD CONSTRAINT "product_docs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_docs" ADD CONSTRAINT "product_docs_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_doc_versions" ADD CONSTRAINT "product_doc_versions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_doc_versions" ADD CONSTRAINT "product_doc_versions_doc_id_company_id_fkey" FOREIGN KEY ("doc_id", "company_id") REFERENCES "product_docs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_plan_runs" ADD CONSTRAINT "product_plan_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_plan_runs" ADD CONSTRAINT "product_plan_runs_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_initiatives" ADD CONSTRAINT "product_initiatives_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ideas" ADD CONSTRAINT "product_ideas_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_manager_employee_id_company_id_fkey" FOREIGN KEY ("manager_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employee_reports" ADD CONSTRAINT "ai_employee_reports_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employee_reports" ADD CONSTRAINT "ai_employee_reports_ai_employee_id_company_id_fkey" FOREIGN KEY ("ai_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employee_reports" ADD CONSTRAINT "ai_employee_reports_manager_employee_id_company_id_fkey" FOREIGN KEY ("manager_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_conversations" ADD CONSTRAINT "ceo_conversations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_messages" ADD CONSTRAINT "ceo_messages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_messages" ADD CONSTRAINT "ceo_messages_conversation_id_company_id_fkey" FOREIGN KEY ("conversation_id", "company_id") REFERENCES "ceo_conversations"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
