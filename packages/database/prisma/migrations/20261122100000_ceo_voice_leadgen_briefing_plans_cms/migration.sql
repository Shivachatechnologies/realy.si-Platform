BEGIN;

-- CreateEnum
CREATE TYPE "AdminNoteTarget" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "BriefingKind" AS ENUM ('MORNING', 'EVENING', 'WEEKLY', 'TEST');

-- CreateEnum
CREATE TYPE "BriefingReportStatus" AS ENUM ('SUMMARIZING', 'DELIVERED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "BriefingChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "BriefingDeliveryStatus" AS ENUM ('SENT', 'FAILED', 'NOT_CONFIGURED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BuilderKitItemStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED', 'NEEDS_SETUP');

-- CreateEnum
CREATE TYPE "CmsEntryKind" AS ENUM ('PAGE', 'POST', 'LANDING');

-- CreateEnum
CREATE TYPE "CmsEntryStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlatformEmailTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "CommandRunOrigin" AS ENUM ('FOUNDER', 'CEO');

-- CreateEnum
CREATE TYPE "CeoCycleStatus" AS ENUM ('RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "CeoPriorityStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'DROPPED');

-- CreateEnum
CREATE TYPE "CeoActionKind" AS ENUM ('DELEGATED', 'RETRIED', 'FOLLOWED_UP', 'ESCALATED', 'REPLANNED', 'PROPOSED', 'HELD');

-- CreateEnum
CREATE TYPE "CeoDecisionStatus" AS ENUM ('OPEN', 'APPROVED', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CrmAutopilotStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmAutopilotAutonomy" AS ENUM ('DRAFT_ONLY', 'REVIEW', 'AUTO_SEND');

-- CreateEnum
CREATE TYPE "CrmAutopilotCompanyStatus" AS ENUM ('PENDING', 'DONE', 'NO_PEOPLE', 'EXCLUDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmEmailVerification" AS ENUM ('VERIFIED', 'RISKY', 'UNVERIFIED', 'INVALID', 'NONE');

-- CreateEnum
CREATE TYPE "CrmProspectPersonStatus" AS ENUM ('FOUND', 'READY', 'SKIPPED', 'CONTACTED', 'REPLIED', 'MEETING', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED');

-- CreateEnum
CREATE TYPE "CrmSuppressionKind" AS ENUM ('EMAIL', 'DOMAIN');

-- CreateEnum
CREATE TYPE "AddonPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ObjectiveInitiativeStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DONE', 'DROPPED');

-- CreateEnum
CREATE TYPE "VoiceProvider" AS ENUM ('VAPI', 'RETELL');

-- CreateEnum
CREATE TYPE "VoiceGoal" AS ENUM ('QUALIFY_LEAD', 'BOOK_MEETING', 'SUPPORT_TRIAGE', 'COLLECTIONS_REMINDER', 'RECEPTIONIST');

-- CreateEnum
CREATE TYPE "VoiceAgentSync" AS ENUM ('DRAFT', 'SYNCED', 'ERROR');

-- CreateEnum
CREATE TYPE "VoiceNumberSource" AS ENUM ('PROVIDER', 'TWILIO');

-- CreateEnum
CREATE TYPE "VoiceCallDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "VoiceCallStatus" AS ENUM ('AWAITING_APPROVAL', 'SCHEDULED', 'QUEUED', 'RINGING', 'IN_PROGRESS', 'ENDED', 'FAILED', 'BLOCKED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VoiceCallOutcome" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'MEETING_REQUESTED', 'MEETING_BOOKED', 'CALLBACK_REQUESTED', 'SUPPORT_ISSUE', 'PAYMENT_PROMISED', 'MESSAGE_TAKEN', 'VOICEMAIL', 'NO_ANSWER', 'WRONG_NUMBER', 'DO_NOT_CALL', 'OTHER');

-- CreateEnum
CREATE TYPE "VoiceSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VoiceCampaignStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoiceDncSource" AS ENUM ('MANUAL', 'CALLER_REQUEST');

-- AlterTable
ALTER TABLE "command_runs" ADD COLUMN     "document_error" TEXT,
ADD COLUMN     "document_id" UUID,
ADD COLUMN     "objective_id" UUID,
ADD COLUMN     "origin" "CommandRunOrigin" NOT NULL DEFAULT 'FOUNDER',
ADD COLUMN     "parent_run_id" UUID,
ADD COLUMN     "priority_id" UUID;

-- AlterTable
ALTER TABLE "command_plan_steps" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "crm_outreach_messages" ADD COLUMN     "autopilot_id" UUID;

-- AlterTable
ALTER TABLE "support_settings" ADD COLUMN     "ai_first_response_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ai_sla_escalation_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "admin_notes" (
    "id" UUID NOT NULL,
    "target_type" "AdminNoteTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "morning_time" TEXT NOT NULL DEFAULT '07:30',
    "days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "evening_enabled" BOOLEAN NOT NULL DEFAULT false,
    "evening_time" TEXT NOT NULL DEFAULT '18:00',
    "weekly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ai_summary" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_number" TEXT,
    "whatsapp_verified_at" TIMESTAMPTZ(3),
    "whatsapp_code_hash" TEXT,
    "whatsapp_code_expires_at" TIMESTAMPTZ(3),
    "whatsapp_last_inbound_at" TIMESTAMPTZ(3),
    "last_morning_slot" TEXT,
    "last_evening_slot" TEXT,
    "last_weekly_slot" TEXT,
    "setup_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "briefing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_channel_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "webhook_key" TEXT NOT NULL,
    "meta_app_secret_enc" TEXT,
    "meta_verify_token" TEXT NOT NULL,
    "meta_template_name" TEXT,
    "meta_template_language" TEXT,
    "twilio_content_sid" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "briefing_channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "BriefingKind" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "data" JSONB NOT NULL,
    "summary" TEXT,
    "summary_task_id" UUID,
    "summary_status" TEXT NOT NULL DEFAULT 'none',
    "status" "BriefingReportStatus" NOT NULL DEFAULT 'SUMMARIZING',
    "deliver_after" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "channels" "BriefingChannel"[] DEFAULT ARRAY[]::"BriefingChannel"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "channel" "BriefingChannel" NOT NULL,
    "status" "BriefingDeliveryStatus" NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_action_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "ref" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "used_via" TEXT,
    "decision" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefing_inbound_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "user_id" UUID,
    "command" TEXT,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "builder_kit_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "status" "BuilderKitItemStatus" NOT NULL DEFAULT 'PENDING',
    "agent_task_id" UUID,
    "brain_document_id" UUID,
    "content" TEXT,
    "data" JSONB,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "error_code" TEXT,
    "error_message" TEXT,
    "error_issues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "builder_kit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_entries" (
    "id" UUID NOT NULL,
    "kind" "CmsEntryKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CmsEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "pending" JSONB,
    "publish_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "live_version" INTEGER,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cms_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_entry_versions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_media" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_email_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PlatformEmailTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "published_subject" TEXT,
    "published_body" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "href" TEXT NOT NULL DEFAULT '/',
    "audience" JSONB NOT NULL,
    "org_count" INTEGER NOT NULL,
    "recipients" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "status" "CeoCycleStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "acting_user_id" UUID NOT NULL,
    "ceo_employee_id" UUID,
    "skipped_reason" TEXT,
    "review" JSONB NOT NULL DEFAULT '{}',
    "delegated" INTEGER NOT NULL DEFAULT 0,
    "followed_up" INTEGER NOT NULL DEFAULT 0,
    "escalated" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ceo_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_priorities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "week_key" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "href" TEXT,
    "profile" TEXT NOT NULL,
    "ai_employee_id" UUID,
    "objective_id" UUID,
    "status" "CeoPriorityStatus" NOT NULL DEFAULT 'ACTIVE',
    "command_run_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_delegated_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ceo_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_actions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cycle_id" UUID,
    "priority_id" UUID,
    "kind" "CeoActionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "profile" TEXT,
    "ai_employee_id" UUID,
    "command_run_id" UUID,
    "task_id" UUID,
    "decision_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ceo_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_decisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "href" TEXT,
    "proposal" JSONB,
    "priority_id" UUID,
    "status" "CeoDecisionStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "command_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ceo_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_prospecting_autopilots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CrmAutopilotStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" TEXT NOT NULL,
    "pitch" TEXT NOT NULL DEFAULT '',
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seniorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "daily_quota" INTEGER NOT NULL DEFAULT 10,
    "daily_send_cap" INTEGER NOT NULL DEFAULT 20,
    "people_per_company" INTEGER NOT NULL DEFAULT 2,
    "autonomy" "CrmAutopilotAutonomy" NOT NULL DEFAULT 'REVIEW',
    "allow_unverified" BOOLEAN NOT NULL DEFAULT false,
    "unverified_daily_cap" INTEGER NOT NULL DEFAULT 3,
    "consent_basis" TEXT NOT NULL DEFAULT 'legitimate_interest',
    "consent_note" TEXT NOT NULL DEFAULT '',
    "provider_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "first_subject" TEXT NOT NULL DEFAULT '',
    "first_body" TEXT NOT NULL DEFAULT '',
    "unsubscribe_line" TEXT NOT NULL DEFAULT '',
    "cadence_id" UUID,
    "owner_id" UUID,
    "activated_by_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "next_run_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_prospecting_autopilots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_autopilot_companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "autopilot_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_url" TEXT,
    "status" "CrmAutopilotCompanyStatus" NOT NULL DEFAULT 'PENDING',
    "people_found" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_autopilot_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_prospect_people" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "autopilot_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "company_name" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "full_name" TEXT NOT NULL,
    "title" TEXT,
    "seniority" TEXT,
    "linkedin_url" TEXT,
    "location" TEXT,
    "source_provider" TEXT NOT NULL,
    "external_id" TEXT,
    "email" TEXT,
    "email_normalized" TEXT,
    "email_status" "CrmEmailVerification" NOT NULL DEFAULT 'NONE',
    "email_source" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "verification" JSONB NOT NULL DEFAULT '{}',
    "consent_basis" TEXT,
    "consent_note" TEXT,
    "status" "CrmProspectPersonStatus" NOT NULL DEFAULT 'FOUND',
    "skip_reason" TEXT,
    "lead_id" UUID,
    "first_message_id" UUID,
    "enrollment_id" UUID,
    "contacted_at" TIMESTAMPTZ(3),
    "replied_at" TIMESTAMPTZ(3),
    "meeting_at" TIMESTAMPTZ(3),
    "bounced_at" TIMESTAMPTZ(3),
    "unsubscribed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_prospect_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_autopilot_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "autopilot_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'ok',
    "companies" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "verified" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "drafted" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "stopped" INTEGER NOT NULL DEFAULT 0,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "crm_autopilot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_suppressions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "CrmSuppressionKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_overrides" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" BIGINT,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entitlement_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_addon_purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "addon_key" TEXT NOT NULL,
    "limit_key" TEXT NOT NULL,
    "packs" INTEGER NOT NULL DEFAULT 1,
    "quantity" BIGINT NOT NULL,
    "status" "AddonPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "stripe_session_id" TEXT,
    "window_start" TIMESTAMPTZ(3),
    "window_end" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entitlement_addon_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_trials" (
    "organization_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_trials_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "objective_executions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "owner_ai_employee_id" UUID,
    "last_progress" DOUBLE PRECISION,
    "last_status" TEXT,
    "off_track_since" TIMESTAMPTZ(3),
    "replanned_at" TIMESTAMPTZ(3),
    "plan_task_id" UUID,
    "last_evaluated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "objective_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_initiatives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "key_result_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ObjectiveInitiativeStatus" NOT NULL DEFAULT 'PLANNED',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "ai_employee_id" UUID,
    "command_run_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "objective_initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_settings" (
    "company_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "VoiceProvider",
    "webhook_key" TEXT NOT NULL,
    "vapi_secret_enc" TEXT,
    "calling_start_min" INTEGER NOT NULL DEFAULT 540,
    "calling_end_min" INTEGER NOT NULL DEFAULT 1080,
    "calling_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "max_duration_sec" INTEGER NOT NULL DEFAULT 600,
    "record_calls" BOOLEAN NOT NULL DEFAULT false,
    "max_concurrent" INTEGER NOT NULL DEFAULT 2,
    "voicemail_user_id" UUID,
    "inbound_tickets" BOOLEAN NOT NULL DEFAULT true,
    "inbound_leads" BOOLEAN NOT NULL DEFAULT true,
    "auto_follow_ups" BOOLEAN NOT NULL DEFAULT true,
    "setup_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "voice_agents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ai_employee_id" UUID,
    "goal" "VoiceGoal" NOT NULL,
    "provider" "VoiceProvider" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "voice_id" TEXT,
    "greeting" TEXT,
    "instructions" TEXT,
    "offer_notes" TEXT,
    "knowledge" TEXT,
    "knowledge_built_at" TIMESTAMPTZ(3),
    "external_agent_id" TEXT,
    "external_llm_id" TEXT,
    "sync_status" "VoiceAgentSync" NOT NULL DEFAULT 'DRAFT',
    "sync_error" TEXT,
    "synced_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_phone_numbers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" "VoiceProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "source" "VoiceNumberSource" NOT NULL DEFAULT 'PROVIDER',
    "twilio_sid" TEXT,
    "inbound_agent_id" UUID,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "number_id" UUID NOT NULL,
    "purpose" TEXT,
    "status" "VoiceCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_id" UUID,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "direction" "VoiceCallDirection" NOT NULL,
    "status" "VoiceCallStatus" NOT NULL,
    "provider" "VoiceProvider",
    "external_call_id" TEXT,
    "agent_id" UUID,
    "number_id" UUID,
    "campaign_id" UUID,
    "to_number" TEXT NOT NULL,
    "from_number" TEXT,
    "lead_id" UUID,
    "contact_id" UUID,
    "subject_name" TEXT,
    "purpose" TEXT,
    "approval_id" UUID,
    "requested_by_id" UUID,
    "requested_by_profile" TEXT,
    "scheduled_for" TIMESTAMPTZ(3),
    "blocked_reason" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "duration_sec" INTEGER,
    "ended_reason" TEXT,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "outcome" "VoiceCallOutcome",
    "sentiment" "VoiceSentiment",
    "analysis" JSONB NOT NULL DEFAULT '{}',
    "recording_url" TEXT,
    "cost_minor" BIGINT,
    "cost_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "processed_at" TIMESTAMPTZ(3),
    "results" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_do_not_call" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "source" "VoiceDncSource" NOT NULL DEFAULT 'MANUAL',
    "call_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_do_not_call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_notes_target_type_target_id_created_at_idx" ON "admin_notes"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "briefing_subscriptions_enabled_idx" ON "briefing_subscriptions"("enabled");

-- CreateIndex
CREATE INDEX "briefing_subscriptions_company_id_whatsapp_number_idx" ON "briefing_subscriptions"("company_id", "whatsapp_number");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_subscriptions_id_company_id_key" ON "briefing_subscriptions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_subscriptions_company_id_user_id_key" ON "briefing_subscriptions"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_channel_configs_company_id_key" ON "briefing_channel_configs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_channel_configs_webhook_key_key" ON "briefing_channel_configs"("webhook_key");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_reports_dedupe_key_key" ON "briefing_reports"("dedupe_key");

-- CreateIndex
CREATE INDEX "briefing_reports_organization_id_company_id_user_id_created_idx" ON "briefing_reports"("organization_id", "company_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "briefing_reports_status_deliver_after_idx" ON "briefing_reports"("status", "deliver_after");

-- CreateIndex
CREATE INDEX "briefing_reports_summary_task_id_idx" ON "briefing_reports"("summary_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_reports_id_company_id_key" ON "briefing_reports"("id", "company_id");

-- CreateIndex
CREATE INDEX "briefing_deliveries_report_id_idx" ON "briefing_deliveries"("report_id");

-- CreateIndex
CREATE INDEX "briefing_deliveries_organization_id_company_id_created_at_idx" ON "briefing_deliveries"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_action_tokens_token_hash_key" ON "briefing_action_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "briefing_action_tokens_company_id_user_id_expires_at_idx" ON "briefing_action_tokens"("company_id", "user_id", "expires_at");

-- CreateIndex
CREATE INDEX "briefing_action_tokens_approval_id_idx" ON "briefing_action_tokens"("approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_action_tokens_report_id_ref_key" ON "briefing_action_tokens"("report_id", "ref");

-- CreateIndex
CREATE INDEX "briefing_inbound_messages_organization_id_company_id_create_idx" ON "briefing_inbound_messages"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_inbound_messages_provider_provider_message_id_key" ON "briefing_inbound_messages"("provider", "provider_message_id");

-- CreateIndex
CREATE INDEX "builder_kit_items_agent_task_id_idx" ON "builder_kit_items"("agent_task_id");

-- CreateIndex
CREATE INDEX "builder_kit_items_status_idx" ON "builder_kit_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "builder_kit_items_run_id_key_key" ON "builder_kit_items"("run_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "builder_kit_items_id_company_id_key" ON "builder_kit_items"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cms_entries_slug_key" ON "cms_entries"("slug");

-- CreateIndex
CREATE INDEX "cms_entries_kind_status_idx" ON "cms_entries"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cms_entry_versions_entry_id_version_key" ON "cms_entry_versions"("entry_id", "version");

-- CreateIndex
CREATE INDEX "cms_media_created_at_idx" ON "cms_media"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_email_templates_key_locale_key" ON "platform_email_templates"("key", "locale");

-- CreateIndex
CREATE INDEX "platform_announcements_created_at_idx" ON "platform_announcements"("created_at");

-- CreateIndex
CREATE INDEX "ceo_cycles_organization_id_company_id_started_at_idx" ON "ceo_cycles"("organization_id", "company_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "ceo_cycles_company_id_day_key" ON "ceo_cycles"("company_id", "day");

-- CreateIndex
CREATE INDEX "ceo_priorities_organization_id_company_id_status_week_key_idx" ON "ceo_priorities"("organization_id", "company_id", "status", "week_key");

-- CreateIndex
CREATE UNIQUE INDEX "ceo_priorities_company_id_week_key_source_key_key" ON "ceo_priorities"("company_id", "week_key", "source_key");

-- CreateIndex
CREATE INDEX "ceo_actions_organization_id_company_id_created_at_idx" ON "ceo_actions"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "ceo_actions_priority_id_idx" ON "ceo_actions"("priority_id");

-- CreateIndex
CREATE INDEX "ceo_decisions_organization_id_company_id_status_created_at_idx" ON "ceo_decisions"("organization_id", "company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ceo_decisions_company_id_source_key_key" ON "ceo_decisions"("company_id", "source_key");

-- CreateIndex
CREATE INDEX "crm_prospecting_autopilots_organization_id_company_id_statu_idx" ON "crm_prospecting_autopilots"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "crm_prospecting_autopilots_status_next_run_at_idx" ON "crm_prospecting_autopilots"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospecting_autopilots_id_company_id_key" ON "crm_prospecting_autopilots"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_autopilot_companies_autopilot_id_status_idx" ON "crm_autopilot_companies"("autopilot_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_autopilot_companies_autopilot_id_domain_key" ON "crm_autopilot_companies"("autopilot_id", "domain");

-- CreateIndex
CREATE INDEX "crm_prospect_people_company_id_email_normalized_idx" ON "crm_prospect_people"("company_id", "email_normalized");

-- CreateIndex
CREATE INDEX "crm_prospect_people_autopilot_id_status_idx" ON "crm_prospect_people"("autopilot_id", "status");

-- CreateIndex
CREATE INDEX "crm_prospect_people_autopilot_id_created_at_idx" ON "crm_prospect_people"("autopilot_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_prospect_people_company_id_lead_id_idx" ON "crm_prospect_people"("company_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospect_people_id_company_id_key" ON "crm_prospect_people"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_prospect_people_autopilot_id_domain_full_name_key" ON "crm_prospect_people"("autopilot_id", "domain", "full_name");

-- CreateIndex
CREATE INDEX "crm_autopilot_runs_autopilot_id_started_at_idx" ON "crm_autopilot_runs"("autopilot_id", "started_at");

-- CreateIndex
CREATE INDEX "crm_suppressions_organization_id_company_id_created_at_idx" ON "crm_suppressions"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_suppressions_company_id_kind_value_key" ON "crm_suppressions"("company_id", "kind", "value");

-- CreateIndex
CREATE INDEX "entitlement_overrides_organization_id_key_revoked_at_idx" ON "entitlement_overrides"("organization_id", "key", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "entitlement_addon_purchases_stripe_session_id_key" ON "entitlement_addon_purchases"("stripe_session_id");

-- CreateIndex
CREATE INDEX "entitlement_addon_purchases_organization_id_status_window_e_idx" ON "entitlement_addon_purchases"("organization_id", "status", "window_end");

-- CreateIndex
CREATE UNIQUE INDEX "objective_executions_objective_id_key" ON "objective_executions"("objective_id");

-- CreateIndex
CREATE INDEX "objective_executions_organization_id_company_id_idx" ON "objective_executions"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "objective_initiatives_objective_id_position_idx" ON "objective_initiatives"("objective_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "voice_settings_webhook_key_key" ON "voice_settings"("webhook_key");

-- CreateIndex
CREATE INDEX "voice_agents_organization_id_company_id_archived_at_idx" ON "voice_agents"("organization_id", "company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_agents_id_company_id_key" ON "voice_agents"("id", "company_id");

-- CreateIndex
CREATE INDEX "voice_phone_numbers_provider_number_idx" ON "voice_phone_numbers"("provider", "number");

-- CreateIndex
CREATE UNIQUE INDEX "voice_phone_numbers_id_company_id_key" ON "voice_phone_numbers"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_phone_numbers_company_id_provider_external_id_key" ON "voice_phone_numbers"("company_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "voice_campaigns_organization_id_company_id_status_idx" ON "voice_campaigns"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "voice_campaigns_id_company_id_key" ON "voice_campaigns"("id", "company_id");

-- CreateIndex
CREATE INDEX "voice_calls_organization_id_company_id_created_at_idx" ON "voice_calls"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_calls_company_id_status_scheduled_for_idx" ON "voice_calls"("company_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "voice_calls_company_id_lead_id_idx" ON "voice_calls"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "voice_calls_company_id_contact_id_idx" ON "voice_calls"("company_id", "contact_id");

-- CreateIndex
CREATE INDEX "voice_calls_campaign_id_idx" ON "voice_calls"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_calls_id_company_id_key" ON "voice_calls"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_calls_provider_external_call_id_key" ON "voice_calls"("provider", "external_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_do_not_call_company_id_phone_key" ON "voice_do_not_call"("company_id", "phone");

-- CreateIndex
CREATE INDEX "command_runs_organization_id_company_id_origin_created_at_idx" ON "command_runs"("organization_id", "company_id", "origin", "created_at");

-- CreateIndex
CREATE INDEX "crm_outreach_messages_autopilot_id_status_sent_at_idx" ON "crm_outreach_messages"("autopilot_id", "status", "sent_at");

-- AddForeignKey
ALTER TABLE "briefing_subscriptions" ADD CONSTRAINT "briefing_subscriptions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_channel_configs" ADD CONSTRAINT "briefing_channel_configs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_reports" ADD CONSTRAINT "briefing_reports_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_deliveries" ADD CONSTRAINT "briefing_deliveries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_deliveries" ADD CONSTRAINT "briefing_deliveries_report_id_company_id_fkey" FOREIGN KEY ("report_id", "company_id") REFERENCES "briefing_reports"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_action_tokens" ADD CONSTRAINT "briefing_action_tokens_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_action_tokens" ADD CONSTRAINT "briefing_action_tokens_report_id_company_id_fkey" FOREIGN KEY ("report_id", "company_id") REFERENCES "briefing_reports"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing_inbound_messages" ADD CONSTRAINT "briefing_inbound_messages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_kit_items" ADD CONSTRAINT "builder_kit_items_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "builder_kit_items" ADD CONSTRAINT "builder_kit_items_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "builder_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_entry_versions" ADD CONSTRAINT "cms_entry_versions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "cms_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_cycles" ADD CONSTRAINT "ceo_cycles_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_priorities" ADD CONSTRAINT "ceo_priorities_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_actions" ADD CONSTRAINT "ceo_actions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_decisions" ADD CONSTRAINT "ceo_decisions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospecting_autopilots" ADD CONSTRAINT "crm_prospecting_autopilots_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_autopilot_companies" ADD CONSTRAINT "crm_autopilot_companies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_autopilot_companies" ADD CONSTRAINT "crm_autopilot_companies_autopilot_id_company_id_fkey" FOREIGN KEY ("autopilot_id", "company_id") REFERENCES "crm_prospecting_autopilots"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospect_people" ADD CONSTRAINT "crm_prospect_people_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_prospect_people" ADD CONSTRAINT "crm_prospect_people_autopilot_id_company_id_fkey" FOREIGN KEY ("autopilot_id", "company_id") REFERENCES "crm_prospecting_autopilots"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_autopilot_runs" ADD CONSTRAINT "crm_autopilot_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_autopilot_runs" ADD CONSTRAINT "crm_autopilot_runs_autopilot_id_company_id_fkey" FOREIGN KEY ("autopilot_id", "company_id") REFERENCES "crm_prospecting_autopilots"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_suppressions" ADD CONSTRAINT "crm_suppressions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_addon_purchases" ADD CONSTRAINT "entitlement_addon_purchases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_trials" ADD CONSTRAINT "entitlement_trials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_executions" ADD CONSTRAINT "objective_executions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_executions" ADD CONSTRAINT "objective_executions_objective_id_company_id_fkey" FOREIGN KEY ("objective_id", "company_id") REFERENCES "objectives"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_initiatives" ADD CONSTRAINT "objective_initiatives_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_initiatives" ADD CONSTRAINT "objective_initiatives_objective_id_company_id_fkey" FOREIGN KEY ("objective_id", "company_id") REFERENCES "objectives"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_settings" ADD CONSTRAINT "voice_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_agents" ADD CONSTRAINT "voice_agents_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_phone_numbers" ADD CONSTRAINT "voice_phone_numbers_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_phone_numbers" ADD CONSTRAINT "voice_phone_numbers_inbound_agent_id_company_id_fkey" FOREIGN KEY ("inbound_agent_id", "company_id") REFERENCES "voice_agents"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_campaigns" ADD CONSTRAINT "voice_campaigns_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_campaigns" ADD CONSTRAINT "voice_campaigns_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "voice_agents"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_campaigns" ADD CONSTRAINT "voice_campaigns_number_id_company_id_fkey" FOREIGN KEY ("number_id", "company_id") REFERENCES "voice_phone_numbers"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "voice_agents"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_number_id_company_id_fkey" FOREIGN KEY ("number_id", "company_id") REFERENCES "voice_phone_numbers"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_campaign_id_company_id_fkey" FOREIGN KEY ("campaign_id", "company_id") REFERENCES "voice_campaigns"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_do_not_call" ADD CONSTRAINT "voice_do_not_call_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
