BEGIN;

-- CreateEnum
CREATE TYPE "LivechatStatus" AS ENUM ('AI_ACTIVE', 'WAITING_HUMAN', 'HUMAN_ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "LivechatAuthor" AS ENUM ('VISITOR', 'AI', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MarketingRunStatus" AS ENUM ('RESEARCHING', 'PLANNING', 'AWAITING_APPROVAL', 'LAUNCHING', 'RUNNING', 'BLOCKED', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingRunAutonomy" AS ENUM ('REVIEW_EVERYTHING', 'APPROVE_PLAN', 'FULL_AUTOPILOT');

-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('OFF', 'SUGGEST', 'ASK', 'AUTO');

-- CreateEnum
CREATE TYPE "AutonomousActionStatus" AS ENUM ('RUNNING', 'EXECUTED', 'FAILED', 'UNDONE');

-- CreateEnum
CREATE TYPE "AutonomyFeedbackKind" AS ENUM ('EDITED', 'COMPLAINT', 'REVERSAL');

-- CreateTable
CREATE TABLE "livechat_settings" (
    "company_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_key" TEXT NOT NULL,
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brand_color" TEXT NOT NULL DEFAULT '#4f46e5',
    "position" TEXT NOT NULL DEFAULT 'right',
    "assistant_name" TEXT NOT NULL DEFAULT 'Assistant',
    "greeting" TEXT,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "brain_tag" TEXT NOT NULL DEFAULT 'website',
    "public_facts" TEXT,
    "auto_create_leads" BOOLEAN NOT NULL DEFAULT true,
    "auto_create_tickets" BOOLEAN NOT NULL DEFAULT true,
    "meetings_enabled" BOOLEAN NOT NULL DEFAULT false,
    "privacy_url" TEXT,
    "retention_days" INTEGER NOT NULL DEFAULT 180,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livechat_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "livechat_visitors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_normalized" TEXT,
    "consent_at" TIMESTAMPTZ(3),
    "consent_text" TEXT,
    "locale" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "lead_id" UUID,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livechat_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livechat_conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "status" "LivechatStatus" NOT NULL DEFAULT 'AI_ACTIVE',
    "locale" TEXT NOT NULL,
    "page_url" TEXT,
    "referrer" TEXT,
    "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lead_id" UUID,
    "ticket_id" UUID,
    "meeting_approval_id" UUID,
    "assignee_id" UUID,
    "handoff_reason" TEXT,
    "handoff_at" TIMESTAMPTZ(3),
    "ai_resolved" BOOLEAN,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "ai_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "ai_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "ai_busy_until" TIMESTAMPTZ(3),
    "agent_typing_at" TIMESTAMPTZ(3),
    "visitor_seen_at" TIMESTAMPTZ(3),
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "livechat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livechat_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author" "LivechatAuthor" NOT NULL,
    "author_user_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livechat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "MarketingRunStatus" NOT NULL DEFAULT 'RESEARCHING',
    "autonomy" "MarketingRunAutonomy" NOT NULL DEFAULT 'APPROVE_PLAN',
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "research_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "plan_id" UUID,
    "campaign_id" UUID,
    "autopilot_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seo_project_id" UUID,
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "log" JSONB NOT NULL DEFAULT '[]',
    "blocked_reason" TEXT,
    "error" TEXT,
    "last_tick_at" TIMESTAMPTZ(3),
    "next_article_at" TIMESTAMPTZ(3),
    "next_newsletter_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "auto_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMPTZ(3),
    "paused_by_id" UUID,
    "pause_reason" TEXT,
    "demotion_threshold" INTEGER NOT NULL DEFAULT 3,
    "demotion_window_days" INTEGER NOT NULL DEFAULT 7,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autonomy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "action_class" TEXT NOT NULL,
    "level" "AutonomyLevel" NOT NULL,
    "daily_limit" INTEGER,
    "per_action_max_minor" BIGINT,
    "daily_max_minor" BIGINT,
    "monthly_max_minor" BIGINT,
    "currency" CHAR(3),
    "hours_from" TEXT,
    "hours_to" TEXT,
    "allowed_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "allowed_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "demoted_at" TIMESTAMPTZ(3),
    "demotion_reason" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autonomy_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomous_actions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "action_class" TEXT NOT NULL,
    "policy_id" UUID,
    "policy_snapshot" JSONB NOT NULL DEFAULT '{}',
    "ai_employee_id" UUID,
    "task_id" UUID,
    "tool" TEXT,
    "source" TEXT,
    "summary" TEXT NOT NULL,
    "input" JSONB,
    "channel" TEXT,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "status" "AutonomousActionStatus" NOT NULL DEFAULT 'RUNNING',
    "records" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" TEXT,
    "error" TEXT,
    "undo" JSONB,
    "undone_at" TIMESTAMPTZ(3),
    "undone_by_id" UUID,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autonomous_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autonomy_feedback" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "action_class" TEXT NOT NULL,
    "kind" "AutonomyFeedbackKind" NOT NULL,
    "ai_employee_id" UUID,
    "autonomous_action_id" UUID,
    "approval_id" UUID,
    "source" TEXT,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autonomy_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "livechat_settings_public_key_key" ON "livechat_settings"("public_key");

-- CreateIndex
CREATE UNIQUE INDEX "livechat_visitors_token_hash_key" ON "livechat_visitors"("token_hash");

-- CreateIndex
CREATE INDEX "livechat_visitors_organization_id_company_id_last_seen_at_idx" ON "livechat_visitors"("organization_id", "company_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "livechat_visitors_company_id_email_normalized_idx" ON "livechat_visitors"("company_id", "email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "livechat_visitors_id_company_id_key" ON "livechat_visitors"("id", "company_id");

-- CreateIndex
CREATE INDEX "livechat_conversations_organization_id_company_id_last_mess_idx" ON "livechat_conversations"("organization_id", "company_id", "last_message_at");

-- CreateIndex
CREATE INDEX "livechat_conversations_company_id_status_idx" ON "livechat_conversations"("company_id", "status");

-- CreateIndex
CREATE INDEX "livechat_conversations_visitor_id_idx" ON "livechat_conversations"("visitor_id");

-- CreateIndex
CREATE UNIQUE INDEX "livechat_conversations_id_company_id_key" ON "livechat_conversations"("id", "company_id");

-- CreateIndex
CREATE INDEX "livechat_messages_conversation_id_created_at_idx" ON "livechat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "livechat_messages_organization_id_company_id_created_at_idx" ON "livechat_messages"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_runs_company_id_status_idx" ON "marketing_runs"("company_id", "status");

-- CreateIndex
CREATE INDEX "marketing_runs_status_last_tick_at_idx" ON "marketing_runs"("status", "last_tick_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_runs_id_company_id_key" ON "marketing_runs"("id", "company_id");

-- CreateIndex
CREATE INDEX "autonomy_settings_organization_id_idx" ON "autonomy_settings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_settings_company_id_key" ON "autonomy_settings"("company_id");

-- CreateIndex
CREATE INDEX "autonomy_policies_organization_id_company_id_idx" ON "autonomy_policies"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_policies_company_id_department_action_class_key" ON "autonomy_policies"("company_id", "department", "action_class");

-- CreateIndex
CREATE INDEX "autonomous_actions_organization_id_company_id_created_at_idx" ON "autonomous_actions"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "autonomous_actions_company_id_department_action_class_day_idx" ON "autonomous_actions"("company_id", "department", "action_class", "day");

-- CreateIndex
CREATE INDEX "autonomous_actions_company_id_department_action_class_month_idx" ON "autonomous_actions"("company_id", "department", "action_class", "month");

-- CreateIndex
CREATE UNIQUE INDEX "autonomous_actions_id_company_id_key" ON "autonomous_actions"("id", "company_id");

-- CreateIndex
CREATE INDEX "autonomy_feedback_company_id_department_action_class_create_idx" ON "autonomy_feedback"("company_id", "department", "action_class", "created_at");

-- CreateIndex
CREATE INDEX "autonomy_feedback_organization_id_company_id_created_at_idx" ON "autonomy_feedback"("organization_id", "company_id", "created_at");

-- AddForeignKey
ALTER TABLE "livechat_settings" ADD CONSTRAINT "livechat_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livechat_visitors" ADD CONSTRAINT "livechat_visitors_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livechat_conversations" ADD CONSTRAINT "livechat_conversations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livechat_conversations" ADD CONSTRAINT "livechat_conversations_visitor_id_company_id_fkey" FOREIGN KEY ("visitor_id", "company_id") REFERENCES "livechat_visitors"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livechat_messages" ADD CONSTRAINT "livechat_messages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livechat_messages" ADD CONSTRAINT "livechat_messages_conversation_id_company_id_fkey" FOREIGN KEY ("conversation_id", "company_id") REFERENCES "livechat_conversations"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_runs" ADD CONSTRAINT "marketing_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_settings" ADD CONSTRAINT "autonomy_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_policies" ADD CONSTRAINT "autonomy_policies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomous_actions" ADD CONSTRAINT "autonomous_actions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autonomy_feedback" ADD CONSTRAINT "autonomy_feedback_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
