BEGIN;

-- pgvector for semantic company memory (supported on Neon). The app falls back to full-text search when absent.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AutopilotMode" AS ENUM ('OFF', 'MANUAL', 'ASSISTED', 'APPROVAL_REQUIRED', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AutopilotRunStatus" AS ENUM ('STARTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MemoryLayer" AS ENUM ('COMPANY', 'KNOWLEDGE', 'DOCUMENT', 'PRODUCT', 'BRAND', 'CUSTOMER', 'DEPARTMENT', 'EMPLOYEE', 'TASK', 'CONVERSATION');

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('COMPANY', 'DEPARTMENT', 'EMPLOYEE', 'TASK');

-- CreateEnum
CREATE TYPE "MemorySourceKind" AS ENUM ('MANUAL', 'AI_APPROVED', 'AI_EMPLOYEE', 'CONVERSATION', 'ROLLUP', 'IMPORT');

-- CreateEnum
CREATE TYPE "MemorySensitivity" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "BrainEmbeddingTarget" AS ENUM ('CHUNK', 'MEMORY');

-- CreateEnum
CREATE TYPE "MeetingIntelKind" AS ENUM ('CRM', 'COMMS');

-- CreateEnum
CREATE TYPE "MeetingFollowUpStatus" AS ENUM ('NONE', 'DRAFT', 'AWAITING_APPROVAL', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('AI_TOKENS', 'IMAGE', 'VIDEO', 'VOICE', 'STT', 'TTS', 'TELEPHONY', 'EMAIL', 'SMS', 'MESSAGING', 'EXTERNAL_API', 'OTHER');

-- CreateEnum
CREATE TYPE "CostBudgetScope" AS ENUM ('COMPANY', 'DEPARTMENT', 'AGENT', 'TASK');

-- CreateEnum
CREATE TYPE "CreativeProjectKind" AS ENUM ('IMAGE_SET', 'VIDEO');

-- CreateEnum
CREATE TYPE "CreativeProjectStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'EXPORTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CreativeStepStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_PROVIDER', 'NEEDS_INPUT', 'BLOCKED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CreativeSceneStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "CreativeAssetKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'CAPTIONS', 'TIMELINE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "VoiceTelephony" AS ENUM ('PROVIDER', 'TWILIO');

-- CreateEnum
CREATE TYPE "VoiceBridgeMode" AS ENUM ('PROVIDER_SIP', 'CUSTOM_SIP', 'MEDIA_STREAM');

-- CreateEnum
CREATE TYPE "VoiceRunStatus" AS ENUM ('PLANNED', 'AWAITING_APPROVAL', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "VoiceRunTargetStatus" AS ENUM ('ELIGIBLE', 'SKIPPED', 'SCHEDULED', 'CALLING', 'NO_ANSWER', 'QUALIFIED', 'NOT_QUALIFIED', 'MEETING_BOOKED', 'FAILED');

-- CreateEnum
CREATE TYPE "VoiceosSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "VoiceosTurnRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "VoiceosTurnKind" AS ENUM ('UTTERANCE', 'ACK', 'ANSWER', 'DECISION', 'NOTICE');

-- CreateEnum
CREATE TYPE "AiOrgDesignStatus" AS ENUM ('DRAFT', 'APPLYING', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiOrgProvisionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CompanyMemoryAuthor" ADD VALUE 'SYSTEM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationHookVerification" ADD VALUE 'TWILIO';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'CALENDLY';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'META';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'ELEVENLABS';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'ZENDESK';
ALTER TYPE "IntegrationHookVerification" ADD VALUE 'INTERCOM';

-- AlterTable
ALTER TABLE "company_memories" ADD COLUMN     "ai_employee_id" UUID,
ADD COLUMN     "dedup_key" CHAR(64),
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_used_at" TIMESTAMPTZ(3),
ADD COLUMN     "layer" "MemoryLayer" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "read_permission" TEXT,
ADD COLUMN     "scope" "MemoryScope" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "sensitivity" "MemorySensitivity" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "source_kind" "MemorySourceKind" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "subject_id" UUID,
ADD COLUMN     "subject_type" TEXT,
ADD COLUMN     "task_id" UUID;

-- AlterTable
ALTER TABLE "voice_settings" ADD COLUMN     "bridge_mode" "VoiceBridgeMode" NOT NULL DEFAULT 'PROVIDER_SIP',
ADD COLUMN     "bridge_sip_uri" TEXT,
ADD COLUMN     "human_transfer_number" TEXT,
ADD COLUMN     "live_transcription" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "media_stream_url" TEXT,
ADD COLUMN     "retry_delay_min" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN     "retry_max_attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sip_password_enc" TEXT,
ADD COLUMN     "sip_username" TEXT,
ADD COLUMN     "telephony" "VoiceTelephony" NOT NULL DEFAULT 'PROVIDER',
ADD COLUMN     "twilio_from_number" TEXT;

-- AlterTable
ALTER TABLE "voice_campaigns" ADD COLUMN     "max_concurrent" INTEGER;

-- AlterTable
ALTER TABLE "voice_calls" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "control_url_enc" TEXT,
ADD COLUMN     "muted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outcome_set_by_id" UUID,
ADD COLUMN     "retry_of_id" UUID,
ADD COLUMN     "taken_over_at" TIMESTAMPTZ(3),
ADD COLUMN     "taken_over_by_id" UUID,
ADD COLUMN     "telephony" "VoiceTelephony",
ADD COLUMN     "telephony_cost_minor" BIGINT,
ADD COLUMN     "telephony_sid" TEXT,
ADD COLUMN     "transferred_to" TEXT;

-- AlterTable
ALTER TABLE "ai_employees" ADD COLUMN     "communication_style" TEXT,
ADD COLUMN     "design_role_key" TEXT,
ADD COLUMN     "last_evaluated_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_evaluation" JSONB,
ADD COLUMN     "org_design_id" UUID,
ADD COLUMN     "personality" TEXT,
ADD COLUMN     "replaced_by_employee_id" UUID,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "working_hours" JSONB;

-- AlterTable
ALTER TABLE "ai_employee_reports" ADD COLUMN     "climb_level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "raised_at" TIMESTAMPTZ(3),
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'normal';

-- CreateTable
CREATE TABLE "autopilot_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "mode" "AutopilotMode" NOT NULL,
    "window_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "window_from" TEXT,
    "window_to" TEXT,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autopilot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopilot_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" "AutopilotMode" NOT NULL,
    "status" "AutopilotRunStatus" NOT NULL,
    "reason" TEXT,
    "title" TEXT,
    "task_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autopilot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_document_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "layer" "MemoryLayer" NOT NULL DEFAULT 'DOCUMENT',
    "sensitivity" "MemorySensitivity" NOT NULL DEFAULT 'INTERNAL',
    "read_permission" TEXT,
    "subject_type" TEXT,
    "subject_id" UUID,
    "ai_employee_id" UUID,
    "expires_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brain_document_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_retention_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "layer" "MemoryLayer" NOT NULL,
    "retention_days" INTEGER,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brain_retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_embeddings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "target_type" "BrainEmbeddingTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_intel" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "MeetingIntelKind" NOT NULL,
    "meeting_id" UUID NOT NULL,
    "agenda" TEXT,
    "prep_brief" TEXT,
    "prep_task_id" UUID,
    "prep_built_at" TIMESTAMPTZ(3),
    "transcript" TEXT,
    "transcript_source" TEXT,
    "transcript_call_id" UUID,
    "transcript_at" TIMESTAMPTZ(3),
    "process_task_id" UUID,
    "summary" TEXT,
    "decisions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action_items" JSONB NOT NULL DEFAULT '[]',
    "proposed_outcome" TEXT,
    "follow_up_subject" TEXT,
    "follow_up_body" TEXT,
    "follow_up_status" "MeetingFollowUpStatus" NOT NULL DEFAULT 'NONE',
    "follow_up_approval_id" UUID,
    "applied_at" TIMESTAMPTZ(3),
    "applied_by_id" UUID,
    "results" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meeting_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_ledger_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "CostCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "operation" TEXT NOT NULL,
    "department" TEXT,
    "ai_employee_id" UUID,
    "task_id" UUID,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'request',
    "cost_micros" BIGINT NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_budgets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "scope" "CostBudgetScope" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "limit_micros" BIGINT NOT NULL,
    "hard_stop" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "threshold" INTEGER NOT NULL,
    "period_key" TEXT NOT NULL,
    "spent_micros" BIGINT NOT NULL,
    "limit_micros" BIGINT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_context_summaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_context_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_request_cache" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "task_id" UUID,
    "model" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_request_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_folders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creative_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "CreativeProjectKind" NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "preset" TEXT,
    "style" TEXT,
    "prompt" TEXT NOT NULL,
    "structure" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creative_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "CreativeProjectKind" NOT NULL,
    "status" "CreativeProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "objective" TEXT,
    "audience" TEXT,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aspect" TEXT NOT NULL DEFAULT '9:16',
    "target_seconds" INTEGER NOT NULL DEFAULT 30,
    "language" TEXT NOT NULL DEFAULT 'en',
    "campaign_id" UUID,
    "template_id" UUID,
    "folder_id" UUID,
    "auto_advance" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "exported_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creative_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "CreativeStepStatus" NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "error" TEXT,
    "provider" TEXT,
    "provider_job_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "next_poll_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creative_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_scenes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "shot" TEXT NOT NULL,
    "narration" TEXT NOT NULL DEFAULT '',
    "on_screen_text" TEXT,
    "seconds" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "media" TEXT NOT NULL DEFAULT 'image',
    "status" "CreativeSceneStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" TEXT,
    "provider_job_id" TEXT,
    "asset_id" UUID,
    "error" TEXT,
    "cost_micros" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creative_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "CreativeAssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "marketing_asset_id" UUID,
    "storage_ref" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "url" TEXT,
    "category" TEXT,
    "role" TEXT,
    "preset" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "prompt" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "folder_id" UUID,
    "project_id" UUID,
    "scene_id" UUID,
    "campaign_id" UUID,
    "template_id" UUID,
    "root_id" UUID,
    "parent_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "operation" TEXT NOT NULL DEFAULT 'generate',
    "cost_micros" BIGINT,
    "brand_check" JSONB,
    "license" JSONB,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creative_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_provider_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "result_ref" TEXT,
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "integration_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "mask" TEXT,
    "type" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "current_minor" BIGINT,
    "available_minor" BIGINT,
    "balance_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_bank_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "booked_on" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "merchant_name" TEXT,
    "category" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(3),
    "finance_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_transcript_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at_sec" INTEGER,
    "source" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_transcript_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_calling_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "agent_id" UUID NOT NULL,
    "number_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "max_concurrent" INTEGER,
    "status" "VoiceRunStatus" NOT NULL DEFAULT 'PLANNED',
    "approval_id" UUID,
    "campaign_id" UUID,
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "requested_by_id" UUID NOT NULL,
    "requested_by_profile" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_calling_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_calling_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brief" TEXT,
    "status" "VoiceRunTargetStatus" NOT NULL DEFAULT 'ELIGIBLE',
    "skip_reason" TEXT,
    "call_id" UUID,
    "meeting_id" UUID,
    "follow_ups" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_calling_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voiceos_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "history_enabled" BOOLEAN NOT NULL DEFAULT false,
    "wake_word_enabled" BOOLEAN NOT NULL DEFAULT false,
    "speak_replies" BOOLEAN NOT NULL DEFAULT true,
    "personality" TEXT NOT NULL DEFAULT 'aria',
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "stt_provider" TEXT NOT NULL DEFAULT 'auto',
    "tts_provider" TEXT NOT NULL DEFAULT 'auto',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voiceos_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voiceos_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "VoiceosSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "command_session_id" UUID,
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "personality" TEXT NOT NULL DEFAULT 'aria',
    "history_enabled" BOOLEAN NOT NULL DEFAULT false,
    "stt_seconds" INTEGER NOT NULL DEFAULT 0,
    "tts_seconds" INTEGER NOT NULL DEFAULT 0,
    "metered_minutes" INTEGER NOT NULL DEFAULT 0,
    "utterances" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voiceos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voiceos_turns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "VoiceosTurnRole" NOT NULL,
    "kind" "VoiceosTurnKind" NOT NULL,
    "text" TEXT,
    "reply_key" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "input_mode" TEXT,
    "provider" TEXT,
    "command_run_id" UUID,
    "approval_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voiceos_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_org_designs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "proposal" JSONB NOT NULL,
    "refined_proposal" JSONB,
    "refine_task_id" UUID,
    "refine_status" TEXT NOT NULL DEFAULT 'none',
    "refine_error" TEXT,
    "applied_variant" TEXT,
    "status" "AiOrgDesignStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_org_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_org_provision_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "design_id" UUID NOT NULL,
    "status" "AiOrgProvisionStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "started_by_id" UUID NOT NULL,
    "lease_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_org_provision_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "autopilot_settings_organization_id_company_id_idx" ON "autopilot_settings"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "autopilot_settings_company_id_department_key" ON "autopilot_settings"("company_id", "department");

-- CreateIndex
CREATE INDEX "autopilot_runs_organization_id_company_id_created_at_idx" ON "autopilot_runs"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "autopilot_runs_company_id_department_created_at_idx" ON "autopilot_runs"("company_id", "department", "created_at");

-- CreateIndex
CREATE INDEX "autopilot_runs_task_id_idx" ON "autopilot_runs"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_document_policies_document_id_key" ON "brain_document_policies"("document_id");

-- CreateIndex
CREATE INDEX "brain_document_policies_company_id_subject_type_subject_id_idx" ON "brain_document_policies"("company_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "brain_document_policies_company_id_ai_employee_id_idx" ON "brain_document_policies"("company_id", "ai_employee_id");

-- CreateIndex
CREATE INDEX "brain_document_policies_expires_at_idx" ON "brain_document_policies"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "brain_retention_policies_company_id_layer_key" ON "brain_retention_policies"("company_id", "layer");

-- CreateIndex
CREATE INDEX "brain_embeddings_company_id_model_target_type_idx" ON "brain_embeddings"("company_id", "model", "target_type");

-- CreateIndex
CREATE UNIQUE INDEX "brain_embeddings_target_type_target_id_model_key" ON "brain_embeddings"("target_type", "target_id", "model");

-- CreateIndex
CREATE INDEX "meeting_intel_organization_id_company_id_updated_at_idx" ON "meeting_intel"("organization_id", "company_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_intel_company_id_kind_meeting_id_key" ON "meeting_intel"("company_id", "kind", "meeting_id");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_organization_id_company_id_occurred_at_idx" ON "cost_ledger_entries"("organization_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_company_id_department_occurred_at_idx" ON "cost_ledger_entries"("company_id", "department", "occurred_at");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_company_id_ai_employee_id_occurred_at_idx" ON "cost_ledger_entries"("company_id", "ai_employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_company_id_task_id_idx" ON "cost_ledger_entries"("company_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_ledger_entries_company_id_source_type_source_id_key" ON "cost_ledger_entries"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "cost_budgets_organization_id_company_id_idx" ON "cost_budgets"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_budgets_company_id_scope_scope_key_key" ON "cost_budgets"("company_id", "scope", "scope_key");

-- CreateIndex
CREATE INDEX "cost_alerts_organization_id_company_id_sent_at_idx" ON "cost_alerts"("organization_id", "company_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_alerts_budget_id_threshold_period_key_key" ON "cost_alerts"("budget_id", "threshold", "period_key");

-- CreateIndex
CREATE INDEX "agent_context_summaries_company_id_task_id_idx" ON "agent_context_summaries"("company_id", "task_id");

-- CreateIndex
CREATE INDEX "agent_request_cache_expires_at_idx" ON "agent_request_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_request_cache_company_id_key_hash_key" ON "agent_request_cache"("company_id", "key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "creative_folders_id_company_id_key" ON "creative_folders"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "creative_folders_company_id_name_key" ON "creative_folders"("company_id", "name");

-- CreateIndex
CREATE INDEX "creative_templates_company_id_kind_archived_at_idx" ON "creative_templates"("company_id", "kind", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "creative_templates_id_company_id_key" ON "creative_templates"("id", "company_id");

-- CreateIndex
CREATE INDEX "creative_projects_company_id_archived_at_updated_at_idx" ON "creative_projects"("company_id", "archived_at", "updated_at");

-- CreateIndex
CREATE INDEX "creative_projects_auto_advance_status_idx" ON "creative_projects"("auto_advance", "status");

-- CreateIndex
CREATE UNIQUE INDEX "creative_projects_id_company_id_key" ON "creative_projects"("id", "company_id");

-- CreateIndex
CREATE INDEX "creative_steps_status_next_poll_at_idx" ON "creative_steps"("status", "next_poll_at");

-- CreateIndex
CREATE UNIQUE INDEX "creative_steps_project_id_key_key" ON "creative_steps"("project_id", "key");

-- CreateIndex
CREATE INDEX "creative_scenes_status_provider_idx" ON "creative_scenes"("status", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "creative_scenes_project_id_position_key" ON "creative_scenes"("project_id", "position");

-- CreateIndex
CREATE INDEX "creative_assets_company_id_archived_at_created_at_idx" ON "creative_assets"("company_id", "archived_at", "created_at");

-- CreateIndex
CREATE INDEX "creative_assets_company_id_project_id_idx" ON "creative_assets"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "creative_assets_company_id_folder_id_idx" ON "creative_assets"("company_id", "folder_id");

-- CreateIndex
CREATE INDEX "creative_assets_company_id_campaign_id_idx" ON "creative_assets"("company_id", "campaign_id");

-- CreateIndex
CREATE INDEX "creative_assets_root_id_idx" ON "creative_assets"("root_id");

-- CreateIndex
CREATE INDEX "creative_assets_marketing_asset_id_idx" ON "creative_assets"("marketing_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "creative_assets_id_company_id_key" ON "creative_assets"("id", "company_id");

-- CreateIndex
CREATE INDEX "integration_provider_events_organization_id_company_id_rece_idx" ON "integration_provider_events"("organization_id", "company_id", "received_at");

-- CreateIndex
CREATE INDEX "integration_provider_events_connection_id_received_at_idx" ON "integration_provider_events"("connection_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_provider_events_connection_id_dedupe_key_key" ON "integration_provider_events"("connection_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "integration_bank_accounts_organization_id_company_id_idx" ON "integration_bank_accounts"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_bank_accounts_connection_id_external_account_id_key" ON "integration_bank_accounts"("connection_id", "external_account_id");

-- CreateIndex
CREATE INDEX "integration_bank_transactions_organization_id_company_id_bo_idx" ON "integration_bank_transactions"("organization_id", "company_id", "booked_on");

-- CreateIndex
CREATE INDEX "integration_bank_transactions_connection_id_external_accoun_idx" ON "integration_bank_transactions"("connection_id", "external_account_id", "booked_on");

-- CreateIndex
CREATE UNIQUE INDEX "integration_bank_transactions_connection_id_external_id_key" ON "integration_bank_transactions"("connection_id", "external_id");

-- CreateIndex
CREATE INDEX "voice_transcript_lines_call_id_created_at_idx" ON "voice_transcript_lines"("call_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_transcript_lines_call_id_dedupe_key_key" ON "voice_transcript_lines"("call_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_calling_runs_campaign_id_key" ON "voice_calling_runs"("campaign_id");

-- CreateIndex
CREATE INDEX "voice_calling_runs_organization_id_company_id_status_idx" ON "voice_calling_runs"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "voice_calling_runs_id_company_id_key" ON "voice_calling_runs"("id", "company_id");

-- CreateIndex
CREATE INDEX "voice_calling_targets_run_id_status_idx" ON "voice_calling_targets"("run_id", "status");

-- CreateIndex
CREATE INDEX "voice_calling_targets_call_id_idx" ON "voice_calling_targets"("call_id");

-- CreateIndex
CREATE UNIQUE INDEX "voiceos_settings_company_id_user_id_key" ON "voiceos_settings"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "voiceos_sessions_organization_id_company_id_user_id_last_ac_idx" ON "voiceos_sessions"("organization_id", "company_id", "user_id", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "voiceos_sessions_id_company_id_key" ON "voiceos_sessions"("id", "company_id");

-- CreateIndex
CREATE INDEX "voiceos_turns_session_id_created_at_idx" ON "voiceos_turns"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voiceos_turns_session_id_command_run_id_kind_key" ON "voiceos_turns"("session_id", "command_run_id", "kind");

-- CreateIndex
CREATE INDEX "ai_org_designs_organization_id_company_id_created_at_idx" ON "ai_org_designs"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_org_designs_id_company_id_key" ON "ai_org_designs"("id", "company_id");

-- CreateIndex
CREATE INDEX "ai_org_provision_jobs_status_lease_until_idx" ON "ai_org_provision_jobs"("status", "lease_until");

-- CreateIndex
CREATE INDEX "ai_org_provision_jobs_design_id_idx" ON "ai_org_provision_jobs"("design_id");

-- CreateIndex
CREATE INDEX "company_memories_company_id_layer_scope_idx" ON "company_memories"("company_id", "layer", "scope");

-- CreateIndex
CREATE INDEX "company_memories_company_id_ai_employee_id_idx" ON "company_memories"("company_id", "ai_employee_id");

-- CreateIndex
CREATE INDEX "company_memories_company_id_task_id_idx" ON "company_memories"("company_id", "task_id");

-- CreateIndex
CREATE INDEX "company_memories_company_id_subject_type_subject_id_idx" ON "company_memories"("company_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "company_memories_expires_at_idx" ON "company_memories"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_memories_company_id_dedup_key_key" ON "company_memories"("company_id", "dedup_key");

-- CreateIndex
CREATE INDEX "voice_calls_telephony_sid_idx" ON "voice_calls"("telephony_sid");

-- CreateIndex
CREATE UNIQUE INDEX "ai_employees_org_design_id_design_role_key_key" ON "ai_employees"("org_design_id", "design_role_key");

-- AddForeignKey
ALTER TABLE "autopilot_settings" ADD CONSTRAINT "autopilot_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_document_policies" ADD CONSTRAINT "brain_document_policies_document_id_company_id_fkey" FOREIGN KEY ("document_id", "company_id") REFERENCES "brain_documents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_retention_policies" ADD CONSTRAINT "brain_retention_policies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_embeddings" ADD CONSTRAINT "brain_embeddings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_intel" ADD CONSTRAINT "meeting_intel_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_budgets" ADD CONSTRAINT "cost_budgets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_alerts" ADD CONSTRAINT "cost_alerts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_alerts" ADD CONSTRAINT "cost_alerts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "cost_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_context_summaries" ADD CONSTRAINT "agent_context_summaries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_request_cache" ADD CONSTRAINT "agent_request_cache_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_folders" ADD CONSTRAINT "creative_folders_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_templates" ADD CONSTRAINT "creative_templates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_steps" ADD CONSTRAINT "creative_steps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_steps" ADD CONSTRAINT "creative_steps_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "creative_projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_scenes" ADD CONSTRAINT "creative_scenes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_scenes" ADD CONSTRAINT "creative_scenes_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "creative_projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_provider_events" ADD CONSTRAINT "integration_provider_events_connection_id_company_id_fkey" FOREIGN KEY ("connection_id", "company_id") REFERENCES "integration_connections"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_bank_accounts" ADD CONSTRAINT "integration_bank_accounts_connection_id_company_id_fkey" FOREIGN KEY ("connection_id", "company_id") REFERENCES "integration_connections"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_bank_transactions" ADD CONSTRAINT "integration_bank_transactions_connection_id_company_id_fkey" FOREIGN KEY ("connection_id", "company_id") REFERENCES "integration_connections"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_transcript_lines" ADD CONSTRAINT "voice_transcript_lines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_transcript_lines" ADD CONSTRAINT "voice_transcript_lines_call_id_company_id_fkey" FOREIGN KEY ("call_id", "company_id") REFERENCES "voice_calls"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calling_runs" ADD CONSTRAINT "voice_calling_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calling_targets" ADD CONSTRAINT "voice_calling_targets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calling_targets" ADD CONSTRAINT "voice_calling_targets_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "voice_calling_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voiceos_settings" ADD CONSTRAINT "voiceos_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voiceos_settings" ADD CONSTRAINT "voiceos_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voiceos_sessions" ADD CONSTRAINT "voiceos_sessions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voiceos_sessions" ADD CONSTRAINT "voiceos_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voiceos_turns" ADD CONSTRAINT "voiceos_turns_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voiceos_turns" ADD CONSTRAINT "voiceos_turns_session_id_company_id_fkey" FOREIGN KEY ("session_id", "company_id") REFERENCES "voiceos_sessions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_org_designs" ADD CONSTRAINT "ai_org_designs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_org_provision_jobs" ADD CONSTRAINT "ai_org_provision_jobs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_org_provision_jobs" ADD CONSTRAINT "ai_org_provision_jobs_design_id_company_id_fkey" FOREIGN KEY ("design_id", "company_id") REFERENCES "ai_org_designs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text and vector indexes (docs/brain-memory.md)
CREATE INDEX IF NOT EXISTS company_memories_fts ON company_memories USING gin (to_tsvector('simple', title || ' ' || fact));
CREATE INDEX IF NOT EXISTS brain_embeddings_hnsw ON brain_embeddings USING hnsw (embedding vector_cosine_ops);

COMMIT;
