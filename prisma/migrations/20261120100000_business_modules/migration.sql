-- Business modules: CRM & sales, marketing, finance, HR, work (projects/product/ops), communication, support,
-- automation, integrations, AI workforce, analytics, marketplace, enterprise + shared entities. Additive only.
BEGIN;


-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowStepStatus" AS ENUM ('RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkflowApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BiChartType" AS ENUM ('NUMBER', 'LINE', 'BAR');

-- CreateEnum
CREATE TYPE "CommsAudience" AS ENUM ('ALL', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "CommsAnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommsChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CommsMeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommsEmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CommsEmailStatus" AS ENUM ('RECEIVED', 'SENT', 'FAILED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "CrmStageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmDealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmEntity" AS ENUM ('LEAD', 'CONTACT', 'ACCOUNT', 'DEAL');

-- CreateEnum
CREATE TYPE "CrmFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK');

-- CreateEnum
CREATE TYPE "CrmAssignmentStrategy" AS ENUM ('ROUND_ROBIN', 'FIXED');

-- CreateEnum
CREATE TYPE "CrmTargetPeriod" AS ENUM ('MONTH', 'QUARTER');

-- CreateEnum
CREATE TYPE "EnterpriseSsoProtocol" AS ENUM ('OIDC', 'SAML');

-- CreateEnum
CREATE TYPE "EnterpriseDataRequestType" AS ENUM ('EXPORT', 'DELETION');

-- CreateEnum
CREATE TYPE "EnterpriseDataRequestStatus" AS ENUM ('PENDING', 'SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "FinanceAccountType" AS ENUM ('BANK', 'CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceTxnType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "FinanceTxnSource" AS ENUM ('MANUAL', 'IMPORT', 'RECURRING', 'PAYMENT', 'AI');

-- CreateEnum
CREATE TYPE "FinanceCategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'TRANSACTION', 'OPENING', 'REVERSAL');

-- CreateEnum
CREATE TYPE "FinancialPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('OPEN', 'APPLIED', 'VOID');

-- CreateEnum
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceEmailKind" AS ENUM ('INVOICE', 'REMINDER', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "FinanceEmailStatus" AS ENUM ('SENT', 'FAILED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "FinanceSequenceKind" AS ENUM ('INVOICE', 'ESTIMATE', 'CREDIT_NOTE', 'JOURNAL');

-- CreateEnum
CREATE TYPE "HrJobStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "HrCandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HrInterviewType" AS ENUM ('PHONE', 'VIDEO', 'ONSITE', 'TECHNICAL', 'PANEL');

-- CreateEnum
CREATE TYPE "HrInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrRecommendation" AS ENUM ('STRONG_NO', 'NO', 'YES', 'STRONG_YES');

-- CreateEnum
CREATE TYPE "HrOfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "HrChecklistKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "HrChecklistCategory" AS ENUM ('GENERAL', 'ACCESS', 'DOCUMENT', 'EQUIPMENT', 'TRAINING');

-- CreateEnum
CREATE TYPE "HrOwnerRole" AS ENUM ('HR', 'MANAGER', 'EMPLOYEE', 'IT');

-- CreateEnum
CREATE TYPE "HrChecklistStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrAssetStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "HrGoalStatus" AS ENUM ('NOT_STARTED', 'ON_TRACK', 'AT_RISK', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrCycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "HrReviewStatus" AS ENUM ('PENDING_SELF', 'PENDING_MANAGER', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HrFeedbackKind" AS ENUM ('PRAISE', 'CONSTRUCTIVE', 'NOTE');

-- CreateEnum
CREATE TYPE "HrPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrLeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HrComponentKind" AS ENUM ('ALLOWANCE', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "HrComponentCalc" AS ENUM ('FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "HrPayPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "HrPayrollStatus" AS ENUM ('DRAFT', 'COMPUTED', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "HrPayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationHookVerification" AS ENUM ('TOKEN', 'HMAC_SHA256');

-- CreateEnum
CREATE TYPE "IntegrationHookDeliveryStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IntegrationWebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MarketingSegmentKind" AS ENUM ('DYNAMIC', 'STATIC');

-- CreateEnum
CREATE TYPE "MarketingContentType" AS ENUM ('BLOG', 'LINKEDIN', 'X', 'INSTAGRAM', 'FACEBOOK', 'AD', 'LANDING_PAGE', 'EMAIL');

-- CreateEnum
CREATE TYPE "MarketingContentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MarketingSocialProvider" AS ENUM ('LINKEDIN', 'X', 'INSTAGRAM', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "MarketingSocialPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketingSocialTargetStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "SeoAuditStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingEmailCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketingSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "MarketingSequenceStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "MarketingEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'STOPPED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "MarketplaceListingType" AS ENUM ('AI_EMPLOYEE', 'AI_AGENT', 'SKILL', 'WORKFLOW', 'INTEGRATION', 'COMPANY_TEMPLATE', 'DEPARTMENT_TEMPLATE', 'INDUSTRY_BLUEPRINT');

-- CreateEnum
CREATE TYPE "MarketplaceListingStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketplacePricingModel" AS ENUM ('FREE', 'ONE_TIME', 'MONTHLY');

-- CreateEnum
CREATE TYPE "MarketplaceInstallStatus" AS ENUM ('ACTIVE', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PROSPECT', 'CUSTOMER', 'PARTNER', 'VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'OFFBOARDING', 'TERMINATED');

-- CreateEnum
CREATE TYPE "WorkTaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportChannel" AS ENUM ('WEB', 'EMAIL', 'CHAT', 'PHONE');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('NEW', 'OPEN', 'PENDING', 'ON_HOLD', 'SOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportMessageKind" AS ENUM ('PUBLIC_REPLY', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "SupportAuthorType" AS ENUM ('AGENT', 'CUSTOMER', 'SYSTEM', 'AI');

-- CreateEnum
CREATE TYPE "SupportAssignmentStrategy" AS ENUM ('ROUND_ROBIN', 'BY_CATEGORY');

-- CreateEnum
CREATE TYPE "SupportEscalationTrigger" AS ENUM ('FIRST_RESPONSE_BREACH', 'RESOLUTION_BREACH');

-- CreateEnum
CREATE TYPE "SupportArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK');

-- CreateEnum
CREATE TYPE "WorkRecurrence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ProjectRiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'CLOSED', 'OCCURRED');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RetroItemKind" AS ENUM ('WENT_WELL', 'TO_IMPROVE', 'ACTION');

-- CreateEnum
CREATE TYPE "ProductItemStatus" AS ENUM ('PROPOSED', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductIdeaStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'PLANNED', 'DECLINED', 'DONE');

-- CreateEnum
CREATE TYPE "ProductReleaseStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'RELEASED');

-- CreateEnum
CREATE TYPE "OpsSchedule" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "OpsAssetStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "OpsIncidentSeverity" AS ENUM ('SEV1', 'SEV2', 'SEV3', 'SEV4');

-- CreateEnum
CREATE TYPE "OpsIncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AiEmployeeStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "AiAutonomyLevel" AS ENUM ('READ_ONLY', 'RECOMMEND', 'PREPARE', 'EXECUTE_WITH_APPROVAL', 'AUTONOMOUS_LOW_RISK');

-- CreateEnum
CREATE TYPE "AiMemorySource" AS ENUM ('MANUAL', 'TASK');

-- CreateEnum
CREATE TYPE "AiScheduleKind" AS ENUM ('RECURRING', 'EVENT');

-- CreateEnum
CREATE TYPE "AiScheduleFrequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "AiBriefingMode" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'TREND_RISK');

-- AlterEnum
ALTER TYPE "LeadActivityType" ADD VALUE 'TASK';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "budget_minor" BIGINT,
ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "currency" CHAR(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "due_date" DATE,
ADD COLUMN     "health" "ProjectHealth" NOT NULL DEFAULT 'ON_TRACK',
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "start_date" DATE,
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "template_key" TEXT;

-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "ai_employee_id" UUID,
ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parent_task_id" UUID,
ADD COLUMN     "subject_id" UUID,
ADD COLUMN     "subject_type" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "authority" TEXT,
ADD COLUMN     "budget" TEXT,
ADD COLUMN     "campaign_code" TEXT,
ADD COLUMN     "converted_at" TIMESTAMPTZ(3),
ADD COLUMN     "converted_deal_id" UUID,
ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "need" TEXT,
ADD COLUMN     "qualified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualified_at" TIMESTAMPTZ(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "territory" TEXT,
ADD COLUMN     "timeline" TEXT;

-- AlterTable
ALTER TABLE "lead_follow_ups" ADD COLUMN     "reminded_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_id" UUID NOT NULL,
    "draft" JSONB NOT NULL,
    "current_version_id" UUID,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "trigger_type" TEXT,
    "trigger_key" TEXT,
    "last_schedule_slot" TEXT,
    "template_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version_id" UUID,
    "definition" JSONB,
    "trigger_event_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_data" JSONB NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMPTZ(3),
    "claim_token" TEXT,
    "claimed_at" TIMESTAMPTZ(3),
    "waiting_for" TEXT,
    "error" TEXT,
    "started_by_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_run_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" TEXT NOT NULL,
    "step_type" TEXT NOT NULL,
    "status" "WorkflowStepStatus" NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    CONSTRAINT "workflow_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_approval_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "approver_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "WorkflowApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dashboards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "bi_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_widgets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "dashboard_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "chart_type" "BiChartType" NOT NULL DEFAULT 'NUMBER',
    "range" TEXT NOT NULL DEFAULT '30d',
    "title" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bi_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metric_keys" TEXT[],
    "range" TEXT NOT NULL DEFAULT '30d',
    "custom_from" DATE,
    "custom_to" DATE,
    "bucketed" BOOLEAN NOT NULL DEFAULT false,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "bi_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_announcements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "CommsAudience" NOT NULL DEFAULT 'ALL',
    "audience_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" "CommsAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "comms_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_announcement_reads" (
    "announcement_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_announcement_reads_pkey" PRIMARY KEY ("announcement_id","user_id")
);

-- CreateTable
CREATE TABLE "comms_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_reactions" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edited_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "CommsChannelVisibility" NOT NULL DEFAULT 'PUBLIC',
    "is_direct" BOOLEAN NOT NULL DEFAULT false,
    "direct_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "comms_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_channel_members" (
    "channel_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_channel_members_pkey" PRIMARY KEY ("channel_id","user_id")
);

-- CreateTable
CREATE TABLE "comms_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_meetings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "CommsMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "decisions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "organizer_id" UUID NOT NULL,
    "external_provider" TEXT,
    "external_id" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "comms_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_meeting_attendees" (
    "meeting_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "comms_meeting_attendees_pkey" PRIMARY KEY ("meeting_id","user_id")
);

-- CreateTable
CREATE TABLE "comms_calendar_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "comms_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_email_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "added_by_id" UUID NOT NULL,
    "last_synced_at" TIMESTAMPTZ(3),
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_email_threads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_id" UUID,
    "provider_thread_id" TEXT,
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contact_id" UUID,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_email_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "provider_message_id" TEXT,
    "direction" "CommsEmailDirection" NOT NULL,
    "status" "CommsEmailStatus" NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_email_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "comms_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_chat_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "external_id" TEXT,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_chat_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "stale_days" INTEGER NOT NULL DEFAULT 30,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 10,
    "type" "CrmStageType" NOT NULL DEFAULT 'OPEN',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID,
    "contact_id" UUID,
    "lead_id" UUID,
    "owner_id" UUID,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "probability" INTEGER,
    "expected_close_date" DATE,
    "status" "CrmDealStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "lost_reason" TEXT,
    "source" TEXT,
    "campaign_code" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "stage_entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_since" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_stage_changes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_deal_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "subject" TEXT,
    "summary" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_min" INTEGER,
    "contact_id" UUID,
    "account_id" UUID,
    "deal_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_follow_ups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT NOT NULL,
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignee_id" UUID,
    "contact_id" UUID,
    "account_id" UUID,
    "deal_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "reminded_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID,
    "account_id" UUID,
    "deal_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_sources" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_fields" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity" "CrmEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CrmFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_segments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity" "CrmEntity" NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_assignment_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" "CrmAssignmentStrategy" NOT NULL DEFAULT 'ROUND_ROBIN',
    "owner_ids" UUID[],
    "match_source" TEXT,
    "match_territory" TEXT,
    "assigned_count" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_stage_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "create_follow_up" BOOLEAN NOT NULL DEFAULT false,
    "follow_up_days" INTEGER NOT NULL DEFAULT 2,
    "follow_up_note" TEXT,
    "create_work_task" BOOLEAN NOT NULL DEFAULT false,
    "work_task_title" TEXT,
    "notify_owner" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_stage_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "period" "CrmTargetPeriod" NOT NULL DEFAULT 'MONTH',
    "period_start" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "deals_target" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "crm_sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_commission_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "pipeline_id" UUID,
    "owner_id" UUID,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_company_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "description" TEXT,
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "address" JSONB NOT NULL DEFAULT '{}',
    "currency_confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "enterprise_company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_org_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "max_members" INTEGER,
    "max_companies" INTEGER,
    "max_workspaces_per_company" INTEGER,
    "max_ai_tokens_per_day" INTEGER,
    "max_api_keys" INTEGER,
    "require_mfa" BOOLEAN NOT NULL DEFAULT false,
    "session_timeout_minutes" INTEGER,
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enforce_sso" BOOLEAN NOT NULL DEFAULT false,
    "audit_retention_days" INTEGER,
    "data_retention_days" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "enterprise_org_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_brandings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_name" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "custom_domain" TEXT,
    "custom_domain_token" TEXT,
    "custom_domain_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "enterprise_brandings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_sso_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "protocol" "EnterpriseSsoProtocol" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT,
    "client_id" TEXT,
    "client_secret_encrypted" TEXT,
    "saml_metadata_xml" TEXT,
    "saml_entity_id" TEXT,
    "saml_sso_url" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "enterprise_sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_sso_domains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enterprise_sso_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_api_key_meta" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "api_key_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scopes" TEXT[],
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enterprise_api_key_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_data_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "EnterpriseDataRequestType" NOT NULL,
    "status" "EnterpriseDataRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requested_by_id" UUID NOT NULL,
    "confirmed_by_id" UUID,
    "scheduled_for" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "enterprise_data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV-',
    "estimate_prefix" TEXT NOT NULL DEFAULT 'EST-',
    "credit_note_prefix" TEXT NOT NULL DEFAULT 'CN-',
    "default_due_days" INTEGER NOT NULL DEFAULT 30,
    "invoice_footer" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "FinanceSequenceKind" NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "finance_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "system_key" TEXT,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "source_id" UUID,
    "reverses_id" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "department_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FinancialPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_tax_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "inclusive" BOOLEAN NOT NULL DEFAULT false,
    "ledger_account_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinanceAccountType" NOT NULL DEFAULT 'BANK',
    "institution" TEXT,
    "number_last4" TEXT,
    "opening_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "opening_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceCategoryKind" NOT NULL,
    "ledger_account_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "FinanceTxnType" NOT NULL,
    "date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "finance_account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "category_id" UUID,
    "account_id" UUID,
    "department_id" UUID,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "source" "FinanceTxnSource" NOT NULL DEFAULT 'MANUAL',
    "recurring_id" UUID,
    "payment_id" UUID,
    "journal_entry_id" UUID,
    "reconciliation_id" UUID,
    "reconciled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_txn_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_txn_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "finance_account_id" UUID NOT NULL,
    "category_id" UUID,
    "account_id" UUID,
    "department_id" UUID,
    "frequency" "FinanceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "next_run_date" DATE NOT NULL,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budgets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "department_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "finance_account_id" UUID NOT NULL,
    "statement_date" DATE NOT NULL,
    "ending_balance_minor" BIGINT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "credited_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "public_token" TEXT,
    "estimate_id" UUID,
    "recurring_invoice_id" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "last_reminder_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "invoice_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID,
    "estimate_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity_milli" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_id" UUID,
    "tax_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "net_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    CONSTRAINT "billing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "frequency" "FinanceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "next_issue_date" DATE NOT NULL,
    "end_date" DATE,
    "due_days" INTEGER NOT NULL DEFAULT 30,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "currency" CHAR(3) NOT NULL,
    "net_minor" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_issued_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "method" "InvoicePaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "finance_account_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "issue_date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "applied_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_note_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_email_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID,
    "estimate_id" UUID,
    "kind" "FinanceEmailKind" NOT NULL,
    "to_email" TEXT NOT NULL,
    "status" "FinanceEmailStatus" NOT NULL,
    "sent_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_plan_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_scenarios" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "revenue_growth_bps" INTEGER NOT NULL DEFAULT 0,
    "expense_change_bps" INTEGER NOT NULL DEFAULT 0,
    "one_offs" JSONB NOT NULL DEFAULT '[]',
    "months" INTEGER NOT NULL DEFAULT 12,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cash_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_designations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_employee_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" UUID,
    "location" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "HrJobStatus" NOT NULL DEFAULT 'DRAFT',
    "openings" INTEGER NOT NULL DEFAULT 1,
    "salary_min_minor" BIGINT,
    "salary_max_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "hiring_manager_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_candidates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "linkedin_url" TEXT,
    "cover_letter" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "stage" "HrCandidateStage" NOT NULL DEFAULT 'APPLIED',
    "rating" INTEGER,
    "resume_filename" TEXT,
    "resume_bytes" BYTEA,
    "resume_size" INTEGER,
    "resume_text" TEXT,
    "ai_score" INTEGER,
    "ai_summary" TEXT,
    "ai_scored_at" TIMESTAMPTZ(3),
    "rejected_reason" TEXT,
    "decision_note" TEXT,
    "hired_at" TIMESTAMPTZ(3),
    "employee_id" UUID,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_candidate_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_candidate_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_interviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "type" "HrInterviewType" NOT NULL DEFAULT 'VIDEO',
    "status" "HrInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 45,
    "location" TEXT,
    "interviewer_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_scorecards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "interview_id" UUID,
    "ratings" JSONB NOT NULL DEFAULT '{}',
    "recommendation" "HrRecommendation" NOT NULL,
    "comments" TEXT,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "salary_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "start_date" DATE,
    "status" "HrOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "terms" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_checklist_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HrChecklistKind" NOT NULL DEFAULT 'ONBOARDING',
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_checklist_template_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "HrChecklistCategory" NOT NULL DEFAULT 'GENERAL',
    "owner_role" "HrOwnerRole" NOT NULL DEFAULT 'HR',
    "due_days" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "hr_checklist_template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_checklists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_id" UUID,
    "kind" "HrChecklistKind" NOT NULL,
    "status" "HrChecklistStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "start_date" DATE NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_checklist_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "HrChecklistCategory" NOT NULL DEFAULT 'GENERAL',
    "owner_role" "HrOwnerRole" NOT NULL DEFAULT 'HR',
    "due_date" DATE,
    "position" INTEGER NOT NULL DEFAULT 0,
    "work_task_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    CONSTRAINT "hr_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'laptop',
    "serial_number" TEXT,
    "status" "HrAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "purchase_date" DATE,
    "value_minor" BIGINT,
    "currency" CHAR(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_asset_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "assigned_by_id" UUID,
    CONSTRAINT "hr_asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_kpis" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "period" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "actual" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_kpis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "objective_id" UUID,
    "due_date" DATE,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" "HrGoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_review_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "HrCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "status" "HrReviewStatus" NOT NULL DEFAULT 'PENDING_SELF',
    "self_rating" INTEGER,
    "self_comments" TEXT,
    "manager_rating" INTEGER,
    "manager_comments" TEXT,
    "self_submitted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_feedback" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "HrFeedbackKind" NOT NULL DEFAULT 'PRAISE',
    "body" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_development_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "focus_area" TEXT,
    "actions" TEXT NOT NULL DEFAULT '',
    "due_date" DATE,
    "status" "HrPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_development_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_attendance" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "clock_in" TIMESTAMPTZ(3) NOT NULL,
    "clock_out" TIMESTAMPTZ(3),
    "minutes" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_work_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "start_time" TEXT NOT NULL DEFAULT '09:00',
    "end_time" TEXT NOT NULL DEFAULT '17:00',
    "break_minutes" INTEGER NOT NULL DEFAULT 60,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "yearly_allowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_allowances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_leave_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_leave_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "HrLeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_holidays" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "requires_ack" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_policy_acks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_policy_acks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_employee_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "details" TEXT,
    "status" "HrRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "handled_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_employee_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_salary_structures" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_salary_components" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "HrComponentKind" NOT NULL,
    "calc" "HrComponentCalc" NOT NULL DEFAULT 'FIXED',
    "amount_minor" BIGINT,
    "percent_bp" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "hr_salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_compensations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "structure_id" UUID,
    "base_monthly_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_compensations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_pay_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "pay_date" DATE NOT NULL,
    "status" "HrPayPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_pay_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payroll_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "status" "HrPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "total_gross_minor" BIGINT NOT NULL DEFAULT 0,
    "total_deductions_minor" BIGINT NOT NULL DEFAULT 0,
    "total_net_minor" BIGINT NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payslips" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "deductions_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_payslip_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "HrPayslipLineKind" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "hr_payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "credentials_enc" TEXT,
    "token_expires_at" TIMESTAMPTZ(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB NOT NULL DEFAULT '{}',
    "external_account" TEXT,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "next_sync_at" TIMESTAMPTZ(3),
    "last_sync_at" TIMESTAMPTZ(3),
    "sync_cursor" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "last_tested_at" TIMESTAMPTZ(3),
    "connected_by_id" UUID NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "items_read" INTEGER NOT NULL DEFAULT 0,
    "items_created" INTEGER NOT NULL DEFAULT 0,
    "items_updated" INTEGER NOT NULL DEFAULT 0,
    "items_skipped" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_hooks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "verification" "IntegrationHookVerification" NOT NULL DEFAULT 'TOKEN',
    "signature_header" TEXT NOT NULL DEFAULT 'x-realy-signature',
    "secret_enc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_received_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_hook_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "hook_id" UUID NOT NULL,
    "status" "IntegrationHookDeliveryStatus" NOT NULL,
    "body" TEXT,
    "content_type" TEXT,
    "error" TEXT,
    "event_id" UUID,
    "ip" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_hook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event_types" TEXT[],
    "secret_enc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IntegrationWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "integration_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_leads" INTEGER,
    "target_revenue_minor" BIGINT,
    "budget_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "segment_id" UUID,
    "launched_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_spend" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "spent_on" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_spend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_segments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "MarketingSegmentKind" NOT NULL DEFAULT 'DYNAMIC',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "account_types" "AccountType"[] DEFAULT ARRAY[]::"AccountType"[],
    "consent_only" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_segment_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_segment_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_suppressions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_content" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "type" "MarketingContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "brief" TEXT,
    "status" "MarketingContentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "scheduled_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "published_url" TEXT,
    "slug" TEXT,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewer_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_content_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'edit',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_content_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_content_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_social_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" "MarketingSocialProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "external_id" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_social_posts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "content_id" UUID,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "media_url" TEXT,
    "status" "MarketingSocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_social_post_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "text" TEXT,
    "status" "MarketingSocialTargetStatus" NOT NULL DEFAULT 'PENDING',
    "provider_post_id" TEXT,
    "provider_url" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,
    "metrics_at" TIMESTAMPTZ(3),
    CONSTRAINT "marketing_social_post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_social_metric_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_social_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "seo_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keywords" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "search_volume" INTEGER,
    "difficulty" INTEGER,
    "intent" TEXT,
    "target_url" TEXT,
    "tracked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "current_rank" INTEGER,
    "previous_rank" INTEGER,
    "ranked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_rank_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "rank" INTEGER,
    "url" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_rank_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_competitors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_audits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status" "SeoAuditStatus" NOT NULL,
    "http_status" INTEGER,
    "error" TEXT,
    "score" INTEGER,
    "title" TEXT,
    "meta_description" TEXT,
    "h1_count" INTEGER,
    "canonical" TEXT,
    "robots" TEXT,
    "image_count" INTEGER,
    "images_with_alt" INTEGER,
    "word_count" INTEGER,
    "internal_links" INTEGER,
    "external_links" INTEGER,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seo_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_email_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_email_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "template_id" UUID,
    "segment_id" UUID,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MarketingEmailCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "not_configured_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_email_sends" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email_campaign_id" UUID,
    "enrollment_id" UUID,
    "step_id" UUID,
    "contact_id" UUID,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "status" "MarketingSendStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "error" TEXT,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(3),
    "clicked_at" TIMESTAMPTZ(3),
    "unsubscribed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_email_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "send_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MarketingSequenceStatus" NOT NULL DEFAULT 'PAUSED',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "trigger_form_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_sequence_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "delay_hours" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_sequence_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "contact_id" UUID,
    "lead_id" UUID,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "first_name" TEXT,
    "status" "MarketingEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_step" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMPTZ(3),
    "source_event_id" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_forms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "submit_label" TEXT,
    "success_message" TEXT,
    "follow_up_hours" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "submission_count" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_form_submissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "lead_id" UUID,
    "data" JSONB NOT NULL,
    "campaign_code" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_publishers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "website" TEXT,
    "logo_url" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketplace_publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" UUID NOT NULL,
    "publisher_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "listing_key" TEXT NOT NULL,
    "type" "MarketplaceListingType" NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "icon_url" TEXT,
    "status" "MarketplaceListingStatus" NOT NULL DEFAULT 'DRAFT',
    "pricing_model" "MarketplacePricingModel" NOT NULL DEFAULT 'FREE',
    "price_minor" BIGINT,
    "currency" CHAR(3),
    "latest_version" TEXT,
    "review_note" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listing_versions" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT NOT NULL DEFAULT '',
    "manifest" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketplace_listing_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_reviews" (
    "id" UUID NOT NULL,
    "listing_key" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketplace_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_installations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "listing_key" TEXT NOT NULL,
    "listing_type" "MarketplaceListingType" NOT NULL,
    "listing_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "MarketplaceInstallStatus" NOT NULL DEFAULT 'ACTIVE',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "installed_by_id" UUID NOT NULL,
    "installed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketplace_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_install_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketplace_install_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL DEFAULT 'PROSPECT',
    "domain" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "country_code" CHAR(2),
    "currency" CHAR(3),
    "source" TEXT,
    "notes" TEXT,
    "owner_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "territory" TEXT,
    "merged_into_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_id" UUID,
    "lead_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "email_normalized" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "title" TEXT,
    "owner_id" UUID,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed_at" TIMESTAMPTZ(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "merged_into_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "head_id" UUID,
    "cost_center_code" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lead_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "department_id" UUID,
    "team_id" UUID,
    "manager_id" UUID,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" DATE,
    "end_date" DATE,
    "location" TEXT,
    "timezone" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "employee_number" TEXT,
    "designation_id" UUID,
    "work_schedule_id" UUID,
    "personal_email" TEXT,
    "date_of_birth" DATE,
    "address" TEXT,
    "emergency_name" TEXT,
    "emergency_phone" TEXT,
    "bio" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "parent_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "WorkPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignee_id" UUID,
    "start_date" DATE,
    "due_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimate_points" INTEGER,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_type" TEXT,
    "source_id" UUID,
    "sprint_id" UUID,
    "milestone_id" UUID,
    "feature_id" UUID,
    "recurrence" "WorkRecurrence",
    "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
    "recurrence_until" DATE,
    "recurrence_spawned_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_settings" (
    "company_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "next_ticket_number" INTEGER NOT NULL DEFAULT 1,
    "help_center_enabled" BOOLEAN NOT NULL DEFAULT true,
    "support_form_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_triage_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "support_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "support_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_priority" "SupportPriority",
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_sla_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT false,
    "business_start_hour" INTEGER NOT NULL DEFAULT 9,
    "business_end_hour" INTEGER NOT NULL DEFAULT 17,
    "business_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "support_sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_sla_targets" (
    "policy_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "priority" "SupportPriority" NOT NULL,
    "first_response_minutes" INTEGER NOT NULL,
    "resolution_minutes" INTEGER NOT NULL,
    CONSTRAINT "support_sla_targets_pkey" PRIMARY KEY ("policy_id","priority")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "requester_id" UUID,
    "account_id" UUID,
    "channel" "SupportChannel" NOT NULL DEFAULT 'WEB',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "category_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignee_id" UUID,
    "team_id" UUID,
    "public_token" TEXT NOT NULL,
    "sla_policy_id" UUID,
    "first_response_due_at" TIMESTAMPTZ(3),
    "resolution_due_at" TIMESTAMPTZ(3),
    "first_responded_at" TIMESTAMPTZ(3),
    "first_response_breached_at" TIMESTAMPTZ(3),
    "resolution_breached_at" TIMESTAMPTZ(3),
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "escalated_at" TIMESTAMPTZ(3),
    "solved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "classification" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "kind" "SupportMessageKind" NOT NULL,
    "author_type" "SupportAuthorType" NOT NULL,
    "author_user_id" UUID,
    "author_name" TEXT,
    "body" TEXT NOT NULL,
    "is_draft" BOOLEAN NOT NULL DEFAULT false,
    "email_status" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "message_id" UUID,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_assignment_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" "SupportAssignmentStrategy" NOT NULL,
    "category_id" UUID,
    "assignee_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_escalation_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "SupportEscalationTrigger" NOT NULL,
    "raise_priority" BOOLEAN NOT NULL DEFAULT true,
    "reassign_to_id" UUID,
    "notify_managers" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_kb_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_kb_articles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SupportArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "views" INTEGER NOT NULL DEFAULT 0,
    "author_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "support_kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,
    "hourly_rate_minor" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blueprint" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_risks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "mitigation" TEXT,
    "owner_id" UUID,
    "status" "ProjectRiskStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "project_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_expenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "incurred_on" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task_dependencies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "depends_on_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mention_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_time_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "user_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "rate_minor" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "capacity_points" INTEGER,
    "committed_points" INTEGER,
    "completed_points" INTEGER,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_retro_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sprint_id" UUID NOT NULL,
    "kind" "RetroItemKind" NOT NULL,
    "text" TEXT NOT NULL,
    "task_id" UUID,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sprint_retro_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_initiatives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quarter" TEXT,
    "status" "ProductItemStatus" NOT NULL DEFAULT 'PLANNED',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_features" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "initiative_id" UUID,
    "project_id" UUID,
    "release_id" UUID,
    "title" TEXT NOT NULL,
    "spec" TEXT,
    "status" "ProductItemStatus" NOT NULL DEFAULT 'PROPOSED',
    "quarter" TEXT,
    "reach" INTEGER,
    "impact" DOUBLE PRECISION,
    "confidence" INTEGER,
    "effort" DOUBLE PRECISION,
    "rice_score" DOUBLE PRECISION,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ideas" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductIdeaStatus" NOT NULL DEFAULT 'NEW',
    "vote_count" INTEGER NOT NULL DEFAULT 0,
    "feature_id" UUID,
    "submitted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_idea_votes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_idea_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_feedback" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "account_id" UUID,
    "contact_id" UUID,
    "feature_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_releases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT,
    "release_date" DATE,
    "status" "ProductReleaseStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_processes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "owner_id" UUID,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ops_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_process_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "change_note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ops_process_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_checklists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "items" JSONB NOT NULL,
    "schedule" "OpsSchedule" NOT NULL DEFAULT 'NONE',
    "next_run_on" DATE,
    "assignee_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ops_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_checklist_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "items" JSONB NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ops_checklist_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "asset_tag" TEXT,
    "category" TEXT,
    "serial_number" TEXT,
    "location" TEXT,
    "status" "OpsAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "assigned_to_id" UUID,
    "purchase_date" DATE,
    "cost_minor" BIGINT,
    "currency" CHAR(3),
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ops_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_incidents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "OpsIncidentSeverity" NOT NULL DEFAULT 'SEV3',
    "status" "OpsIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "owner_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "postmortem" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ops_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "profile_key" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "instructions" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runs_as_user_id" UUID,
    "status" "AiEmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "autonomy" "AiAutonomyLevel" NOT NULL DEFAULT 'EXECUTE_WITH_APPROVAL',
    "monthly_token_budget" INTEGER,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    CONSTRAINT "ai_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_employee_memories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ai_employee_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "source" "AiMemorySource" NOT NULL DEFAULT 'MANUAL',
    "source_task_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_employee_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ai_employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AiScheduleKind" NOT NULL,
    "frequency" "AiScheduleFrequency",
    "time_of_day" TEXT,
    "weekday" INTEGER,
    "event_type" TEXT,
    "instructions" TEXT NOT NULL,
    "briefing_mode" "AiBriefingMode",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_slot" TEXT,
    "last_run_at" TIMESTAMPTZ(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ai_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_schedule_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "task_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_schedule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_briefings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mode" "AiBriefingMode" NOT NULL,
    "profile" TEXT NOT NULL,
    "task_id" UUID,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "kpis" JSONB NOT NULL DEFAULT '[]',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "scheduled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflows_organization_id_company_id_status_idx" ON "workflows"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "workflows_status_trigger_type_trigger_key_idx" ON "workflows"("status", "trigger_type", "trigger_key");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_id_company_id_key" ON "workflows"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_id_company_id_key" ON "workflow_versions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_id_version_key" ON "workflow_versions"("workflow_id", "version");

-- CreateIndex
CREATE INDEX "workflow_runs_organization_id_company_id_created_at_idx" ON "workflow_runs"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_runs_status_next_run_at_idx" ON "workflow_runs"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "workflow_runs_workflow_id_created_at_idx" ON "workflow_runs"("workflow_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_id_company_id_key" ON "workflow_runs"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_workflow_id_trigger_event_id_key" ON "workflow_runs"("workflow_id", "trigger_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_run_steps_run_id_step_id_key" ON "workflow_run_steps"("run_id", "step_id");

-- CreateIndex
CREATE INDEX "workflow_approval_requests_organization_id_company_id_statu_idx" ON "workflow_approval_requests"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_approval_requests_run_id_step_id_key" ON "workflow_approval_requests"("run_id", "step_id");

-- CreateIndex
CREATE INDEX "bi_dashboards_organization_id_company_id_idx" ON "bi_dashboards"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "bi_dashboards_id_company_id_key" ON "bi_dashboards"("id", "company_id");

-- CreateIndex
CREATE INDEX "bi_widgets_dashboard_id_position_idx" ON "bi_widgets"("dashboard_id", "position");

-- CreateIndex
CREATE INDEX "bi_reports_organization_id_company_id_idx" ON "bi_reports"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "comms_announcements_organization_id_company_id_status_publi_idx" ON "comms_announcements"("organization_id", "company_id", "status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_announcements_id_company_id_key" ON "comms_announcements"("id", "company_id");

-- CreateIndex
CREATE INDEX "comms_posts_organization_id_company_id_created_at_idx" ON "comms_posts"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_posts_id_company_id_key" ON "comms_posts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_reactions_post_id_user_id_emoji_key" ON "comms_reactions"("post_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "comms_comments_company_id_subject_type_subject_id_created_a_idx" ON "comms_comments"("company_id", "subject_type", "subject_id", "created_at");

-- CreateIndex
CREATE INDEX "comms_channels_organization_id_company_id_is_direct_idx" ON "comms_channels"("organization_id", "company_id", "is_direct");

-- CreateIndex
CREATE UNIQUE INDEX "comms_channels_id_company_id_key" ON "comms_channels"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_channels_company_id_direct_key_key" ON "comms_channels"("company_id", "direct_key");

-- CreateIndex
CREATE INDEX "comms_channel_members_user_id_idx" ON "comms_channel_members"("user_id");

-- CreateIndex
CREATE INDEX "comms_messages_channel_id_parent_id_created_at_idx" ON "comms_messages"("channel_id", "parent_id", "created_at");

-- CreateIndex
CREATE INDEX "comms_meetings_organization_id_company_id_starts_at_idx" ON "comms_meetings"("organization_id", "company_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_meetings_id_company_id_key" ON "comms_meetings"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_meetings_company_id_external_provider_external_id_key" ON "comms_meetings"("company_id", "external_provider", "external_id");

-- CreateIndex
CREATE INDEX "comms_meeting_attendees_user_id_idx" ON "comms_meeting_attendees"("user_id");

-- CreateIndex
CREATE INDEX "comms_calendar_events_organization_id_company_id_starts_at_idx" ON "comms_calendar_events"("organization_id", "company_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_email_accounts_id_company_id_key" ON "comms_email_accounts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_email_accounts_company_id_provider_address_key" ON "comms_email_accounts"("company_id", "provider", "address");

-- CreateIndex
CREATE INDEX "comms_email_threads_organization_id_company_id_last_message_idx" ON "comms_email_threads"("organization_id", "company_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_email_threads_id_company_id_key" ON "comms_email_threads"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_email_threads_account_id_provider_thread_id_key" ON "comms_email_threads"("account_id", "provider_thread_id");

-- CreateIndex
CREATE INDEX "comms_email_messages_thread_id_sent_at_idx" ON "comms_email_messages"("thread_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "comms_email_messages_thread_id_provider_message_id_key" ON "comms_email_messages"("thread_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_email_templates_company_id_name_key" ON "comms_email_templates"("company_id", "name");

-- CreateIndex
CREATE INDEX "comms_chat_posts_company_id_subject_type_subject_id_idx" ON "comms_chat_posts"("company_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "crm_pipelines_organization_id_company_id_idx" ON "crm_pipelines"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_id_company_id_key" ON "crm_pipelines"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_pipeline_id_position_idx" ON "crm_pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipeline_stages_id_company_id_key" ON "crm_pipeline_stages"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_deals_organization_id_company_id_status_idx" ON "crm_deals"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "crm_deals_pipeline_id_stage_id_idx" ON "crm_deals"("pipeline_id", "stage_id");

-- CreateIndex
CREATE INDEX "crm_deals_company_id_owner_id_idx" ON "crm_deals"("company_id", "owner_id");

-- CreateIndex
CREATE INDEX "crm_deals_account_id_idx" ON "crm_deals"("account_id");

-- CreateIndex
CREATE INDEX "crm_deals_contact_id_idx" ON "crm_deals"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_id_company_id_key" ON "crm_deals"("id", "company_id");

-- CreateIndex
CREATE INDEX "crm_deal_stage_changes_deal_id_changed_at_idx" ON "crm_deal_stage_changes"("deal_id", "changed_at");

-- CreateIndex
CREATE INDEX "crm_activities_organization_id_company_id_occurred_at_idx" ON "crm_activities"("organization_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_activities_contact_id_occurred_at_idx" ON "crm_activities"("contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_activities_account_id_occurred_at_idx" ON "crm_activities"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_activities_deal_id_occurred_at_idx" ON "crm_activities"("deal_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crm_follow_ups_company_id_completed_at_due_at_idx" ON "crm_follow_ups"("company_id", "completed_at", "due_at");

-- CreateIndex
CREATE INDEX "crm_follow_ups_assignee_id_completed_at_idx" ON "crm_follow_ups"("assignee_id", "completed_at");

-- CreateIndex
CREATE INDEX "crm_follow_ups_deal_id_idx" ON "crm_follow_ups"("deal_id");

-- CreateIndex
CREATE INDEX "crm_attachments_company_id_lead_id_idx" ON "crm_attachments"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "crm_attachments_company_id_contact_id_idx" ON "crm_attachments"("company_id", "contact_id");

-- CreateIndex
CREATE INDEX "crm_attachments_company_id_account_id_idx" ON "crm_attachments"("company_id", "account_id");

-- CreateIndex
CREATE INDEX "crm_attachments_company_id_deal_id_idx" ON "crm_attachments"("company_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_lead_sources_company_id_name_key" ON "crm_lead_sources"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_fields_company_id_entity_key_key" ON "crm_custom_fields"("company_id", "entity", "key");

-- CreateIndex
CREATE INDEX "crm_segments_company_id_entity_idx" ON "crm_segments"("company_id", "entity");

-- CreateIndex
CREATE INDEX "crm_assignment_rules_company_id_active_position_idx" ON "crm_assignment_rules"("company_id", "active", "position");

-- CreateIndex
CREATE INDEX "crm_stage_rules_stage_id_active_idx" ON "crm_stage_rules"("stage_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sales_targets_company_id_owner_id_period_period_start_key" ON "crm_sales_targets"("company_id", "owner_id", "period", "period_start");

-- CreateIndex
CREATE INDEX "crm_commission_rules_company_id_active_idx" ON "crm_commission_rules"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_company_profiles_company_id_key" ON "enterprise_company_profiles"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_org_settings_organization_id_key" ON "enterprise_org_settings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_brandings_organization_id_key" ON "enterprise_brandings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_brandings_custom_domain_key" ON "enterprise_brandings"("custom_domain");

-- CreateIndex
CREATE INDEX "enterprise_sso_connections_organization_id_idx" ON "enterprise_sso_connections"("organization_id");

-- CreateIndex
CREATE INDEX "enterprise_sso_domains_domain_idx" ON "enterprise_sso_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_sso_domains_organization_id_domain_key" ON "enterprise_sso_domains"("organization_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_api_key_meta_api_key_id_key" ON "enterprise_api_key_meta"("api_key_id");

-- CreateIndex
CREATE INDEX "enterprise_api_key_meta_organization_id_idx" ON "enterprise_api_key_meta"("organization_id");

-- CreateIndex
CREATE INDEX "enterprise_data_requests_organization_id_company_id_created_idx" ON "enterprise_data_requests"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "enterprise_data_requests_status_scheduled_for_idx" ON "enterprise_data_requests"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_company_id_key" ON "finance_settings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_sequences_company_id_kind_key" ON "finance_sequences"("company_id", "kind");

-- CreateIndex
CREATE INDEX "ledger_accounts_organization_id_company_id_type_idx" ON "ledger_accounts"("organization_id", "company_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_id_company_id_key" ON "ledger_accounts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_company_id_code_key" ON "ledger_accounts"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_company_id_system_key_key" ON "ledger_accounts"("company_id", "system_key");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_company_id_date_idx" ON "journal_entries"("organization_id", "company_id", "date");

-- CreateIndex
CREATE INDEX "journal_entries_company_id_source_source_id_idx" ON "journal_entries"("company_id", "source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_id_company_id_key" ON "journal_entries"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_number_key" ON "journal_entries"("company_id", "number");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_ledger_account_id_idx" ON "journal_lines"("ledger_account_id");

-- CreateIndex
CREATE INDEX "financial_periods_company_id_start_date_idx" ON "financial_periods"("company_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_tax_rates_id_company_id_key" ON "finance_tax_rates"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_tax_rates_company_id_name_key" ON "finance_tax_rates"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "finance_accounts_id_company_id_key" ON "finance_accounts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_accounts_company_id_name_key" ON "finance_accounts"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_id_company_id_key" ON "finance_categories"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_company_id_kind_name_key" ON "finance_categories"("company_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_payment_id_key" ON "finance_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "finance_transactions_organization_id_company_id_date_idx" ON "finance_transactions"("organization_id", "company_id", "date");

-- CreateIndex
CREATE INDEX "finance_transactions_company_id_type_date_idx" ON "finance_transactions"("company_id", "type", "date");

-- CreateIndex
CREATE INDEX "finance_transactions_finance_account_id_date_idx" ON "finance_transactions"("finance_account_id", "date");

-- CreateIndex
CREATE INDEX "finance_transactions_company_id_category_id_idx" ON "finance_transactions"("company_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_id_company_id_key" ON "finance_transactions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_txn_attachments_transaction_id_key" ON "finance_txn_attachments"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_txn_attachments_transaction_id_company_id_key" ON "finance_txn_attachments"("transaction_id", "company_id");

-- CreateIndex
CREATE INDEX "recurring_expenses_active_next_run_date_idx" ON "recurring_expenses"("active", "next_run_date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_expenses_id_company_id_key" ON "recurring_expenses"("id", "company_id");

-- CreateIndex
CREATE INDEX "finance_budgets_company_id_period_start_idx" ON "finance_budgets"("company_id", "period_start");

-- CreateIndex
CREATE INDEX "reconciliations_finance_account_id_status_idx" ON "reconciliations"("finance_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_id_company_id_key" ON "reconciliations"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_public_token_key" ON "invoices"("public_token");

-- CreateIndex
CREATE INDEX "invoices_organization_id_company_id_status_idx" ON "invoices"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "invoices_company_id_due_date_idx" ON "invoices"("company_id", "due_date");

-- CreateIndex
CREATE INDEX "invoices_account_id_idx" ON "invoices"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_company_id_key" ON "invoices"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_company_id_number_key" ON "invoices"("company_id", "number");

-- CreateIndex
CREATE INDEX "estimates_organization_id_company_id_status_idx" ON "estimates"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_id_company_id_key" ON "estimates"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_company_id_number_key" ON "estimates"("company_id", "number");

-- CreateIndex
CREATE INDEX "billing_lines_invoice_id_idx" ON "billing_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "billing_lines_estimate_id_idx" ON "billing_lines"("estimate_id");

-- CreateIndex
CREATE INDEX "recurring_invoices_active_next_issue_date_idx" ON "recurring_invoices"("active", "next_issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_invoices_id_company_id_key" ON "recurring_invoices"("id", "company_id");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_payments_company_id_date_idx" ON "invoice_payments"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_id_company_id_key" ON "credit_notes"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_company_id_number_key" ON "credit_notes"("company_id", "number");

-- CreateIndex
CREATE INDEX "credit_note_applications_invoice_id_idx" ON "credit_note_applications"("invoice_id");

-- CreateIndex
CREATE INDEX "finance_email_logs_invoice_id_idx" ON "finance_email_logs"("invoice_id");

-- CreateIndex
CREATE INDEX "finance_email_logs_estimate_id_idx" ON "finance_email_logs"("estimate_id");

-- CreateIndex
CREATE INDEX "cash_plan_items_company_id_date_idx" ON "cash_plan_items"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_scenarios_company_id_name_key" ON "cash_scenarios"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hr_designations_id_company_id_key" ON "hr_designations"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_designations_company_id_name_key" ON "hr_designations"("company_id", "name");

-- CreateIndex
CREATE INDEX "hr_employee_events_employee_id_created_at_idx" ON "hr_employee_events"("employee_id", "created_at");

-- CreateIndex
CREATE INDEX "hr_employee_events_company_id_kind_created_at_idx" ON "hr_employee_events"("company_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "hr_documents_employee_id_idx" ON "hr_documents"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_documents_id_company_id_key" ON "hr_documents"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_jobs_organization_id_company_id_status_idx" ON "hr_jobs"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_jobs_id_company_id_key" ON "hr_jobs"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_candidates_organization_id_company_id_stage_idx" ON "hr_candidates"("organization_id", "company_id", "stage");

-- CreateIndex
CREATE INDEX "hr_candidates_job_id_stage_idx" ON "hr_candidates"("job_id", "stage");

-- CreateIndex
CREATE INDEX "hr_candidates_company_id_email_idx" ON "hr_candidates"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "hr_candidates_id_company_id_key" ON "hr_candidates"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_candidate_notes_candidate_id_created_at_idx" ON "hr_candidate_notes"("candidate_id", "created_at");

-- CreateIndex
CREATE INDEX "hr_interviews_candidate_id_scheduled_at_idx" ON "hr_interviews"("candidate_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "hr_interviews_company_id_scheduled_at_idx" ON "hr_interviews"("company_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "hr_interviews_id_company_id_key" ON "hr_interviews"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_scorecards_candidate_id_idx" ON "hr_scorecards"("candidate_id");

-- CreateIndex
CREATE INDEX "hr_offers_candidate_id_idx" ON "hr_offers"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_offers_id_company_id_key" ON "hr_offers"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_checklist_templates_company_id_kind_idx" ON "hr_checklist_templates"("company_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "hr_checklist_templates_id_company_id_key" ON "hr_checklist_templates"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_checklist_template_tasks_template_id_position_idx" ON "hr_checklist_template_tasks"("template_id", "position");

-- CreateIndex
CREATE INDEX "hr_checklists_organization_id_company_id_status_idx" ON "hr_checklists"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "hr_checklists_employee_id_idx" ON "hr_checklists"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_checklists_id_company_id_key" ON "hr_checklists"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_checklist_items_checklist_id_position_idx" ON "hr_checklist_items"("checklist_id", "position");

-- CreateIndex
CREATE INDEX "hr_checklist_items_work_task_id_idx" ON "hr_checklist_items"("work_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_checklist_items_id_company_id_key" ON "hr_checklist_items"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_assets_company_id_status_idx" ON "hr_assets"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_assets_id_company_id_key" ON "hr_assets"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_assets_company_id_tag_key" ON "hr_assets"("company_id", "tag");

-- CreateIndex
CREATE INDEX "hr_asset_assignments_asset_id_assigned_at_idx" ON "hr_asset_assignments"("asset_id", "assigned_at");

-- CreateIndex
CREATE INDEX "hr_asset_assignments_employee_id_idx" ON "hr_asset_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "hr_kpis_employee_id_period_idx" ON "hr_kpis"("employee_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "hr_kpis_id_company_id_key" ON "hr_kpis"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_goals_employee_id_status_idx" ON "hr_goals"("employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_goals_id_company_id_key" ON "hr_goals"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_review_cycles_company_id_status_idx" ON "hr_review_cycles"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_review_cycles_id_company_id_key" ON "hr_review_cycles"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_reviews_employee_id_idx" ON "hr_reviews"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reviews_id_company_id_key" ON "hr_reviews"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reviews_cycle_id_employee_id_key" ON "hr_reviews"("cycle_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_feedback_employee_id_created_at_idx" ON "hr_feedback"("employee_id", "created_at");

-- CreateIndex
CREATE INDEX "hr_development_plans_employee_id_idx" ON "hr_development_plans"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_development_plans_id_company_id_key" ON "hr_development_plans"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_attendance_employee_id_date_idx" ON "hr_attendance"("employee_id", "date");

-- CreateIndex
CREATE INDEX "hr_attendance_company_id_date_idx" ON "hr_attendance"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_work_schedules_id_company_id_key" ON "hr_work_schedules"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_work_schedules_company_id_name_key" ON "hr_work_schedules"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_types_id_company_id_key" ON "hr_leave_types"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_types_company_id_name_key" ON "hr_leave_types"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_allowances_employee_id_leave_type_id_year_key" ON "hr_leave_allowances"("employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "hr_leave_requests_organization_id_company_id_status_idx" ON "hr_leave_requests"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "hr_leave_requests_employee_id_start_date_idx" ON "hr_leave_requests"("employee_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_leave_requests_id_company_id_key" ON "hr_leave_requests"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_holidays_company_id_date_key" ON "hr_holidays"("company_id", "date");

-- CreateIndex
CREATE INDEX "hr_policies_company_id_published_at_idx" ON "hr_policies"("company_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "hr_policies_id_company_id_key" ON "hr_policies"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_policy_acks_policy_id_employee_id_version_key" ON "hr_policy_acks"("policy_id", "employee_id", "version");

-- CreateIndex
CREATE INDEX "hr_employee_requests_organization_id_company_id_status_idx" ON "hr_employee_requests"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "hr_employee_requests_employee_id_idx" ON "hr_employee_requests"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_employee_requests_id_company_id_key" ON "hr_employee_requests"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_salary_structures_id_company_id_key" ON "hr_salary_structures"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_salary_structures_company_id_name_key" ON "hr_salary_structures"("company_id", "name");

-- CreateIndex
CREATE INDEX "hr_salary_components_structure_id_position_idx" ON "hr_salary_components"("structure_id", "position");

-- CreateIndex
CREATE INDEX "hr_compensations_employee_id_effective_from_idx" ON "hr_compensations"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "hr_pay_periods_id_company_id_key" ON "hr_pay_periods"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_pay_periods_company_id_name_key" ON "hr_pay_periods"("company_id", "name");

-- CreateIndex
CREATE INDEX "hr_payroll_runs_organization_id_company_id_status_idx" ON "hr_payroll_runs"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payroll_runs_id_company_id_key" ON "hr_payroll_runs"("id", "company_id");

-- CreateIndex
CREATE INDEX "hr_payslips_employee_id_idx" ON "hr_payslips"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payslips_id_company_id_key" ON "hr_payslips"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_payslips_run_id_employee_id_key" ON "hr_payslips"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "hr_payslip_lines_payslip_id_position_idx" ON "hr_payslip_lines"("payslip_id", "position");

-- CreateIndex
CREATE INDEX "integration_connections_organization_id_company_id_status_idx" ON "integration_connections"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "integration_connections_sync_enabled_next_sync_at_idx" ON "integration_connections"("sync_enabled", "next_sync_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_id_company_id_key" ON "integration_connections"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_company_id_provider_key" ON "integration_connections"("company_id", "provider");

-- CreateIndex
CREATE INDEX "integration_sync_runs_organization_id_company_id_started_at_idx" ON "integration_sync_runs"("organization_id", "company_id", "started_at");

-- CreateIndex
CREATE INDEX "integration_sync_runs_connection_id_started_at_idx" ON "integration_sync_runs"("connection_id", "started_at");

-- CreateIndex
CREATE INDEX "integration_hooks_organization_id_company_id_idx" ON "integration_hooks"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_hooks_id_company_id_key" ON "integration_hooks"("id", "company_id");

-- CreateIndex
CREATE INDEX "integration_hook_deliveries_hook_id_received_at_idx" ON "integration_hook_deliveries"("hook_id", "received_at");

-- CreateIndex
CREATE INDEX "integration_webhook_subscriptions_organization_id_company_i_idx" ON "integration_webhook_subscriptions"("organization_id", "company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_subscriptions_id_company_id_key" ON "integration_webhook_subscriptions"("id", "company_id");

-- CreateIndex
CREATE INDEX "integration_webhook_deliveries_status_next_attempt_at_idx" ON "integration_webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "integration_webhook_deliveries_subscription_id_created_at_idx" ON "integration_webhook_deliveries"("subscription_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_deliveries_subscription_id_event_id_key" ON "integration_webhook_deliveries"("subscription_id", "event_id");

-- CreateIndex
CREATE INDEX "marketing_campaigns_organization_id_company_id_status_idx" ON "marketing_campaigns"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_campaigns_id_company_id_key" ON "marketing_campaigns"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_campaigns_company_id_code_key" ON "marketing_campaigns"("company_id", "code");

-- CreateIndex
CREATE INDEX "marketing_spend_company_id_spent_on_idx" ON "marketing_spend"("company_id", "spent_on");

-- CreateIndex
CREATE INDEX "marketing_spend_campaign_id_idx" ON "marketing_spend"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_segments_id_company_id_key" ON "marketing_segments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_segments_company_id_name_key" ON "marketing_segments"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_segment_members_segment_id_contact_id_key" ON "marketing_segment_members"("segment_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_suppressions_company_id_email_normalized_key" ON "marketing_suppressions"("company_id", "email_normalized");

-- CreateIndex
CREATE INDEX "marketing_content_organization_id_company_id_status_idx" ON "marketing_content"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "marketing_content_company_id_scheduled_at_idx" ON "marketing_content"("company_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_content_id_company_id_key" ON "marketing_content"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_content_versions_content_id_version_key" ON "marketing_content_versions"("content_id", "version");

-- CreateIndex
CREATE INDEX "marketing_content_comments_content_id_created_at_idx" ON "marketing_content_comments"("content_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_social_accounts_id_company_id_key" ON "marketing_social_accounts"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_social_posts_organization_id_company_id_status_idx" ON "marketing_social_posts"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "marketing_social_posts_status_scheduled_at_idx" ON "marketing_social_posts"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_social_posts_id_company_id_key" ON "marketing_social_posts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_social_post_targets_id_company_id_key" ON "marketing_social_post_targets"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_social_post_targets_post_id_account_id_key" ON "marketing_social_post_targets"("post_id", "account_id");

-- CreateIndex
CREATE INDEX "marketing_social_metric_snapshots_target_id_captured_at_idx" ON "marketing_social_metric_snapshots"("target_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "seo_projects_id_company_id_key" ON "seo_projects"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_id_company_id_key" ON "seo_keywords"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_keywords_project_id_keyword_key" ON "seo_keywords"("project_id", "keyword");

-- CreateIndex
CREATE INDEX "seo_rank_snapshots_keyword_id_captured_at_idx" ON "seo_rank_snapshots"("keyword_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "seo_competitors_project_id_domain_key" ON "seo_competitors"("project_id", "domain");

-- CreateIndex
CREATE INDEX "seo_audits_project_id_created_at_idx" ON "seo_audits"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "seo_audits_id_company_id_key" ON "seo_audits"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_email_templates_id_company_id_key" ON "marketing_email_templates"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_email_campaigns_organization_id_company_id_status_idx" ON "marketing_email_campaigns"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "marketing_email_campaigns_status_scheduled_at_idx" ON "marketing_email_campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_email_campaigns_id_company_id_key" ON "marketing_email_campaigns"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_email_sends_company_id_created_at_idx" ON "marketing_email_sends"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_email_sends_id_company_id_key" ON "marketing_email_sends"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_email_sends_email_campaign_id_email_normalized_key" ON "marketing_email_sends"("email_campaign_id", "email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_email_sends_enrollment_id_step_id_key" ON "marketing_email_sends"("enrollment_id", "step_id");

-- CreateIndex
CREATE INDEX "marketing_email_events_send_id_created_at_idx" ON "marketing_email_events"("send_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_sequences_company_id_status_trigger_idx" ON "marketing_sequences"("company_id", "status", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_sequences_id_company_id_key" ON "marketing_sequences"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_sequence_steps_sequence_id_position_idx" ON "marketing_sequence_steps"("sequence_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_sequence_steps_id_company_id_key" ON "marketing_sequence_steps"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_sequence_enrollments_status_next_run_at_idx" ON "marketing_sequence_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_sequence_enrollments_id_company_id_key" ON "marketing_sequence_enrollments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_sequence_enrollments_sequence_id_email_normalized_key" ON "marketing_sequence_enrollments"("sequence_id", "email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_forms_id_company_id_key" ON "marketing_forms"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_form_submissions_form_id_created_at_idx" ON "marketing_form_submissions"("form_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_form_submissions_company_id_created_at_idx" ON "marketing_form_submissions"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_publishers_organization_id_key" ON "marketplace_publishers"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_publishers_slug_key" ON "marketplace_publishers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_listing_key_key" ON "marketplace_listings"("listing_key");

-- CreateIndex
CREATE INDEX "marketplace_listings_status_type_idx" ON "marketplace_listings"("status", "type");

-- CreateIndex
CREATE INDEX "marketplace_listings_organization_id_idx" ON "marketplace_listings"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listing_versions_listing_id_version_key" ON "marketplace_listing_versions"("listing_id", "version");

-- CreateIndex
CREATE INDEX "marketplace_reviews_listing_key_created_at_idx" ON "marketplace_reviews"("listing_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_reviews_listing_key_user_id_key" ON "marketplace_reviews"("listing_key", "user_id");

-- CreateIndex
CREATE INDEX "marketplace_installations_organization_id_company_id_status_idx" ON "marketplace_installations"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_installations_id_company_id_key" ON "marketplace_installations"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_installations_company_id_listing_key_key" ON "marketplace_installations"("company_id", "listing_key");

-- CreateIndex
CREATE INDEX "marketplace_install_items_installation_id_idx" ON "marketplace_install_items"("installation_id");

-- CreateIndex
CREATE INDEX "accounts_organization_id_company_id_type_idx" ON "accounts"("organization_id", "company_id", "type");

-- CreateIndex
CREATE INDEX "accounts_company_id_name_idx" ON "accounts"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_company_id_key" ON "accounts"("id", "company_id");

-- CreateIndex
CREATE INDEX "contacts_organization_id_company_id_idx" ON "contacts"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_email_normalized_idx" ON "contacts"("company_id", "email_normalized");

-- CreateIndex
CREATE INDEX "contacts_account_id_idx" ON "contacts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_id_company_id_key" ON "contacts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_company_id_key" ON "departments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_company_id_name_key" ON "departments"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_company_id_key" ON "teams"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_company_id_name_key" ON "teams"("company_id", "name");

-- CreateIndex
CREATE INDEX "employees_organization_id_company_id_status_idx" ON "employees"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "employees_user_id_idx" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_company_id_manager_id_idx" ON "employees"("company_id", "manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_company_id_key" ON "employees"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_employee_number_key" ON "employees"("company_id", "employee_number");

-- CreateIndex
CREATE INDEX "work_tasks_organization_id_company_id_status_idx" ON "work_tasks"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "work_tasks_project_id_status_position_idx" ON "work_tasks"("project_id", "status", "position");

-- CreateIndex
CREATE INDEX "work_tasks_assignee_id_status_idx" ON "work_tasks"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "work_tasks_company_id_source_type_source_id_idx" ON "work_tasks"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "work_tasks_sprint_id_idx" ON "work_tasks"("sprint_id");

-- CreateIndex
CREATE INDEX "work_tasks_company_id_due_date_idx" ON "work_tasks"("company_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "work_tasks_id_company_id_key" ON "work_tasks"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_categories_id_company_id_key" ON "support_categories"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_categories_company_id_name_key" ON "support_categories"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "support_sla_policies_id_company_id_key" ON "support_sla_policies"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_sla_policies_company_id_name_key" ON "support_sla_policies"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_public_token_key" ON "support_tickets"("public_token");

-- CreateIndex
CREATE INDEX "support_tickets_organization_id_company_id_status_idx" ON "support_tickets"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_company_id_assignee_id_status_idx" ON "support_tickets"("company_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_requester_id_idx" ON "support_tickets"("requester_id");

-- CreateIndex
CREATE INDEX "support_tickets_account_id_idx" ON "support_tickets"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_id_company_id_key" ON "support_tickets"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_company_id_number_key" ON "support_tickets"("company_id", "number");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_id_company_id_key" ON "support_messages"("id", "company_id");

-- CreateIndex
CREATE INDEX "support_attachments_ticket_id_idx" ON "support_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "support_assignment_rules_company_id_active_position_idx" ON "support_assignment_rules"("company_id", "active", "position");

-- CreateIndex
CREATE INDEX "support_escalation_rules_company_id_active_idx" ON "support_escalation_rules"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "support_kb_categories_id_company_id_key" ON "support_kb_categories"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_kb_categories_company_id_name_key" ON "support_kb_categories"("company_id", "name");

-- CreateIndex
CREATE INDEX "support_kb_articles_organization_id_company_id_status_idx" ON "support_kb_articles"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "support_kb_articles_company_id_slug_key" ON "support_kb_articles"("company_id", "slug");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_id_company_id_key" ON "project_templates"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_templates_company_id_name_key" ON "project_templates"("company_id", "name");

-- CreateIndex
CREATE INDEX "project_milestones_project_id_due_date_idx" ON "project_milestones"("project_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestones_id_company_id_key" ON "project_milestones"("id", "company_id");

-- CreateIndex
CREATE INDEX "project_risks_project_id_status_idx" ON "project_risks"("project_id", "status");

-- CreateIndex
CREATE INDEX "project_risks_organization_id_company_id_status_idx" ON "project_risks"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "project_expenses_project_id_idx" ON "project_expenses"("project_id");

-- CreateIndex
CREATE INDEX "work_task_dependencies_depends_on_id_idx" ON "work_task_dependencies"("depends_on_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_task_dependencies_task_id_depends_on_id_key" ON "work_task_dependencies"("task_id", "depends_on_id");

-- CreateIndex
CREATE INDEX "work_task_comments_task_id_created_at_idx" ON "work_task_comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "work_task_attachments_task_id_idx" ON "work_task_attachments"("task_id");

-- CreateIndex
CREATE INDEX "work_time_entries_project_id_work_date_idx" ON "work_time_entries"("project_id", "work_date");

-- CreateIndex
CREATE INDEX "work_time_entries_task_id_idx" ON "work_time_entries"("task_id");

-- CreateIndex
CREATE INDEX "work_time_entries_user_id_work_date_idx" ON "work_time_entries"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "sprints_project_id_status_idx" ON "sprints"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_id_company_id_key" ON "sprints"("id", "company_id");

-- CreateIndex
CREATE INDEX "sprint_retro_items_sprint_id_idx" ON "sprint_retro_items"("sprint_id");

-- CreateIndex
CREATE INDEX "product_initiatives_company_id_quarter_idx" ON "product_initiatives"("company_id", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "product_initiatives_id_company_id_key" ON "product_initiatives"("id", "company_id");

-- CreateIndex
CREATE INDEX "product_features_company_id_status_idx" ON "product_features"("company_id", "status");

-- CreateIndex
CREATE INDEX "product_features_company_id_rice_score_idx" ON "product_features"("company_id", "rice_score");

-- CreateIndex
CREATE UNIQUE INDEX "product_features_id_company_id_key" ON "product_features"("id", "company_id");

-- CreateIndex
CREATE INDEX "product_ideas_company_id_status_vote_count_idx" ON "product_ideas"("company_id", "status", "vote_count");

-- CreateIndex
CREATE UNIQUE INDEX "product_ideas_id_company_id_key" ON "product_ideas"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_idea_votes_idea_id_user_id_key" ON "product_idea_votes"("idea_id", "user_id");

-- CreateIndex
CREATE INDEX "product_feedback_company_id_created_at_idx" ON "product_feedback"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "product_feedback_feature_id_idx" ON "product_feedback"("feature_id");

-- CreateIndex
CREATE INDEX "product_releases_company_id_published_at_idx" ON "product_releases"("company_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_releases_id_company_id_key" ON "product_releases"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_releases_company_id_version_key" ON "product_releases"("company_id", "version");

-- CreateIndex
CREATE INDEX "ops_processes_company_id_category_idx" ON "ops_processes"("company_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ops_processes_id_company_id_key" ON "ops_processes"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ops_process_versions_process_id_version_key" ON "ops_process_versions"("process_id", "version");

-- CreateIndex
CREATE INDEX "ops_checklists_schedule_next_run_on_idx" ON "ops_checklists"("schedule", "next_run_on");

-- CreateIndex
CREATE UNIQUE INDEX "ops_checklists_id_company_id_key" ON "ops_checklists"("id", "company_id");

-- CreateIndex
CREATE INDEX "ops_checklist_runs_company_id_completed_at_idx" ON "ops_checklist_runs"("company_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "ops_checklist_runs_checklist_id_due_on_key" ON "ops_checklist_runs"("checklist_id", "due_on");

-- CreateIndex
CREATE INDEX "ops_assets_company_id_status_idx" ON "ops_assets"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ops_assets_company_id_asset_tag_key" ON "ops_assets"("company_id", "asset_tag");

-- CreateIndex
CREATE INDEX "ops_incidents_company_id_status_idx" ON "ops_incidents"("company_id", "status");

-- CreateIndex
CREATE INDEX "ops_incidents_company_id_occurred_at_idx" ON "ops_incidents"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_employees_organization_id_company_id_status_idx" ON "ai_employees"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_employees_id_company_id_key" ON "ai_employees"("id", "company_id");

-- CreateIndex
CREATE INDEX "ai_employee_memories_ai_employee_id_pinned_created_at_idx" ON "ai_employee_memories"("ai_employee_id", "pinned", "created_at");

-- CreateIndex
CREATE INDEX "ai_schedules_kind_enabled_idx" ON "ai_schedules"("kind", "enabled");

-- CreateIndex
CREATE INDEX "ai_schedules_organization_id_company_id_idx" ON "ai_schedules"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_schedules_id_company_id_key" ON "ai_schedules"("id", "company_id");

-- CreateIndex
CREATE INDEX "ai_schedule_runs_task_id_idx" ON "ai_schedule_runs"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_schedule_runs_schedule_id_slot_key" ON "ai_schedule_runs"("schedule_id", "slot");

-- CreateIndex
CREATE INDEX "ai_briefings_organization_id_company_id_created_at_idx" ON "ai_briefings"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "projects_company_id_status_idx" ON "projects"("company_id", "status");

-- CreateIndex
CREATE INDEX "agent_tasks_company_id_subject_type_subject_id_idx" ON "agent_tasks"("company_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "agent_tasks_ai_employee_id_status_idx" ON "agent_tasks"("ai_employee_id", "status");

-- CreateIndex
CREATE INDEX "agent_tasks_parent_task_id_idx" ON "agent_tasks"("parent_task_id");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_company_id_fkey" FOREIGN KEY ("workflow_id", "company_id") REFERENCES "workflows"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_company_id_fkey" FOREIGN KEY ("workflow_id", "company_id") REFERENCES "workflows"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_version_id_company_id_fkey" FOREIGN KEY ("version_id", "company_id") REFERENCES "workflow_versions"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "workflow_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approval_requests" ADD CONSTRAINT "workflow_approval_requests_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_approval_requests" ADD CONSTRAINT "workflow_approval_requests_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "workflow_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_dashboard_id_company_id_fkey" FOREIGN KEY ("dashboard_id", "company_id") REFERENCES "bi_dashboards"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_reports" ADD CONSTRAINT "bi_reports_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_announcements" ADD CONSTRAINT "comms_announcements_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_announcement_reads" ADD CONSTRAINT "comms_announcement_reads_announcement_id_company_id_fkey" FOREIGN KEY ("announcement_id", "company_id") REFERENCES "comms_announcements"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_posts" ADD CONSTRAINT "comms_posts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_reactions" ADD CONSTRAINT "comms_reactions_post_id_company_id_fkey" FOREIGN KEY ("post_id", "company_id") REFERENCES "comms_posts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_comments" ADD CONSTRAINT "comms_comments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_channels" ADD CONSTRAINT "comms_channels_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_channel_members" ADD CONSTRAINT "comms_channel_members_channel_id_company_id_fkey" FOREIGN KEY ("channel_id", "company_id") REFERENCES "comms_channels"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_messages" ADD CONSTRAINT "comms_messages_channel_id_company_id_fkey" FOREIGN KEY ("channel_id", "company_id") REFERENCES "comms_channels"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_messages" ADD CONSTRAINT "comms_messages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comms_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_meetings" ADD CONSTRAINT "comms_meetings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_meeting_attendees" ADD CONSTRAINT "comms_meeting_attendees_meeting_id_company_id_fkey" FOREIGN KEY ("meeting_id", "company_id") REFERENCES "comms_meetings"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_calendar_events" ADD CONSTRAINT "comms_calendar_events_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_email_accounts" ADD CONSTRAINT "comms_email_accounts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_email_threads" ADD CONSTRAINT "comms_email_threads_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_email_threads" ADD CONSTRAINT "comms_email_threads_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "comms_email_accounts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_email_messages" ADD CONSTRAINT "comms_email_messages_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "comms_email_threads"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_email_templates" ADD CONSTRAINT "comms_email_templates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_chat_posts" ADD CONSTRAINT "comms_chat_posts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_ai_employee_id_company_id_fkey" FOREIGN KEY ("ai_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_parent_task_id_company_id_fkey" FOREIGN KEY ("parent_task_id", "company_id") REFERENCES "agent_tasks"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_company_id_fkey" FOREIGN KEY ("pipeline_id", "company_id") REFERENCES "crm_pipelines"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "leads"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_pipeline_id_company_id_fkey" FOREIGN KEY ("pipeline_id", "company_id") REFERENCES "crm_pipelines"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_stage_id_company_id_fkey" FOREIGN KEY ("stage_id", "company_id") REFERENCES "crm_pipeline_stages"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_stage_changes" ADD CONSTRAINT "crm_deal_stage_changes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_stage_changes" ADD CONSTRAINT "crm_deal_stage_changes_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_follow_ups" ADD CONSTRAINT "crm_follow_ups_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_attachments" ADD CONSTRAINT "crm_attachments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_attachments" ADD CONSTRAINT "crm_attachments_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "leads"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_attachments" ADD CONSTRAINT "crm_attachments_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_attachments" ADD CONSTRAINT "crm_attachments_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_attachments" ADD CONSTRAINT "crm_attachments_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_sources" ADD CONSTRAINT "crm_lead_sources_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_fields" ADD CONSTRAINT "crm_custom_fields_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_segments" ADD CONSTRAINT "crm_segments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_assignment_rules" ADD CONSTRAINT "crm_assignment_rules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stage_rules" ADD CONSTRAINT "crm_stage_rules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_stage_rules" ADD CONSTRAINT "crm_stage_rules_stage_id_company_id_fkey" FOREIGN KEY ("stage_id", "company_id") REFERENCES "crm_pipeline_stages"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_targets" ADD CONSTRAINT "crm_sales_targets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commission_rules" ADD CONSTRAINT "crm_commission_rules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commission_rules" ADD CONSTRAINT "crm_commission_rules_pipeline_id_company_id_fkey" FOREIGN KEY ("pipeline_id", "company_id") REFERENCES "crm_pipelines"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_company_profiles" ADD CONSTRAINT "enterprise_company_profiles_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_org_settings" ADD CONSTRAINT "enterprise_org_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_brandings" ADD CONSTRAINT "enterprise_brandings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_sso_connections" ADD CONSTRAINT "enterprise_sso_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_sso_domains" ADD CONSTRAINT "enterprise_sso_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_api_key_meta" ADD CONSTRAINT "enterprise_api_key_meta_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_data_requests" ADD CONSTRAINT "enterprise_data_requests_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_sequences" ADD CONSTRAINT "finance_sequences_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_company_id_fkey" FOREIGN KEY ("entry_id", "company_id") REFERENCES "journal_entries"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_ledger_account_id_company_id_fkey" FOREIGN KEY ("ledger_account_id", "company_id") REFERENCES "ledger_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_tax_rates" ADD CONSTRAINT "finance_tax_rates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_tax_rates" ADD CONSTRAINT "finance_tax_rates_ledger_account_id_company_id_fkey" FOREIGN KEY ("ledger_account_id", "company_id") REFERENCES "ledger_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_ledger_account_id_company_id_fkey" FOREIGN KEY ("ledger_account_id", "company_id") REFERENCES "ledger_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_ledger_account_id_company_id_fkey" FOREIGN KEY ("ledger_account_id", "company_id") REFERENCES "ledger_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_finance_account_id_company_id_fkey" FOREIGN KEY ("finance_account_id", "company_id") REFERENCES "finance_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_to_account_id_company_id_fkey" FOREIGN KEY ("to_account_id", "company_id") REFERENCES "finance_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "finance_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_recurring_id_company_id_fkey" FOREIGN KEY ("recurring_id", "company_id") REFERENCES "recurring_expenses"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_reconciliation_id_company_id_fkey" FOREIGN KEY ("reconciliation_id", "company_id") REFERENCES "reconciliations"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_txn_attachments" ADD CONSTRAINT "finance_txn_attachments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_txn_attachments" ADD CONSTRAINT "finance_txn_attachments_transaction_id_company_id_fkey" FOREIGN KEY ("transaction_id", "company_id") REFERENCES "finance_transactions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_finance_account_id_company_id_fkey" FOREIGN KEY ("finance_account_id", "company_id") REFERENCES "finance_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "finance_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "finance_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_finance_account_id_company_id_fkey" FOREIGN KEY ("finance_account_id", "company_id") REFERENCES "finance_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_invoice_id_company_id_fkey" FOREIGN KEY ("recurring_invoice_id", "company_id") REFERENCES "recurring_invoices"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_estimate_id_company_id_fkey" FOREIGN KEY ("estimate_id", "company_id") REFERENCES "estimates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_tax_rate_id_company_id_fkey" FOREIGN KEY ("tax_rate_id", "company_id") REFERENCES "finance_tax_rates"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_finance_account_id_company_id_fkey" FOREIGN KEY ("finance_account_id", "company_id") REFERENCES "finance_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_applications" ADD CONSTRAINT "credit_note_applications_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_applications" ADD CONSTRAINT "credit_note_applications_credit_note_id_company_id_fkey" FOREIGN KEY ("credit_note_id", "company_id") REFERENCES "credit_notes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_applications" ADD CONSTRAINT "credit_note_applications_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_email_logs" ADD CONSTRAINT "finance_email_logs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_email_logs" ADD CONSTRAINT "finance_email_logs_invoice_id_company_id_fkey" FOREIGN KEY ("invoice_id", "company_id") REFERENCES "invoices"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_email_logs" ADD CONSTRAINT "finance_email_logs_estimate_id_company_id_fkey" FOREIGN KEY ("estimate_id", "company_id") REFERENCES "estimates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_plan_items" ADD CONSTRAINT "cash_plan_items_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_scenarios" ADD CONSTRAINT "cash_scenarios_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_designations" ADD CONSTRAINT "hr_designations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_events" ADD CONSTRAINT "hr_employee_events_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_events" ADD CONSTRAINT "hr_employee_events_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_documents" ADD CONSTRAINT "hr_documents_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_jobs" ADD CONSTRAINT "hr_jobs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_jobs" ADD CONSTRAINT "hr_jobs_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_jobs" ADD CONSTRAINT "hr_jobs_hiring_manager_id_company_id_fkey" FOREIGN KEY ("hiring_manager_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_job_id_company_id_fkey" FOREIGN KEY ("job_id", "company_id") REFERENCES "hr_jobs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_candidate_notes" ADD CONSTRAINT "hr_candidate_notes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_candidate_notes" ADD CONSTRAINT "hr_candidate_notes_candidate_id_company_id_fkey" FOREIGN KEY ("candidate_id", "company_id") REFERENCES "hr_candidates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_interviews" ADD CONSTRAINT "hr_interviews_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_interviews" ADD CONSTRAINT "hr_interviews_candidate_id_company_id_fkey" FOREIGN KEY ("candidate_id", "company_id") REFERENCES "hr_candidates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_scorecards" ADD CONSTRAINT "hr_scorecards_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_scorecards" ADD CONSTRAINT "hr_scorecards_candidate_id_company_id_fkey" FOREIGN KEY ("candidate_id", "company_id") REFERENCES "hr_candidates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_scorecards" ADD CONSTRAINT "hr_scorecards_interview_id_company_id_fkey" FOREIGN KEY ("interview_id", "company_id") REFERENCES "hr_interviews"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_offers" ADD CONSTRAINT "hr_offers_candidate_id_company_id_fkey" FOREIGN KEY ("candidate_id", "company_id") REFERENCES "hr_candidates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklist_templates" ADD CONSTRAINT "hr_checklist_templates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklist_template_tasks" ADD CONSTRAINT "hr_checklist_template_tasks_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklist_template_tasks" ADD CONSTRAINT "hr_checklist_template_tasks_template_id_company_id_fkey" FOREIGN KEY ("template_id", "company_id") REFERENCES "hr_checklist_templates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklists" ADD CONSTRAINT "hr_checklists_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklists" ADD CONSTRAINT "hr_checklists_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklists" ADD CONSTRAINT "hr_checklists_template_id_company_id_fkey" FOREIGN KEY ("template_id", "company_id") REFERENCES "hr_checklist_templates"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklist_items" ADD CONSTRAINT "hr_checklist_items_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_checklist_items" ADD CONSTRAINT "hr_checklist_items_checklist_id_company_id_fkey" FOREIGN KEY ("checklist_id", "company_id") REFERENCES "hr_checklists"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_assets" ADD CONSTRAINT "hr_assets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_asset_assignments" ADD CONSTRAINT "hr_asset_assignments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_asset_assignments" ADD CONSTRAINT "hr_asset_assignments_asset_id_company_id_fkey" FOREIGN KEY ("asset_id", "company_id") REFERENCES "hr_assets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_asset_assignments" ADD CONSTRAINT "hr_asset_assignments_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_kpis" ADD CONSTRAINT "hr_kpis_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_kpis" ADD CONSTRAINT "hr_kpis_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_goals" ADD CONSTRAINT "hr_goals_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_review_cycles" ADD CONSTRAINT "hr_review_cycles_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_cycle_id_company_id_fkey" FOREIGN KEY ("cycle_id", "company_id") REFERENCES "hr_review_cycles"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reviews" ADD CONSTRAINT "hr_reviews_reviewer_id_company_id_fkey" FOREIGN KEY ("reviewer_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_feedback" ADD CONSTRAINT "hr_feedback_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_feedback" ADD CONSTRAINT "hr_feedback_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_development_plans" ADD CONSTRAINT "hr_development_plans_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_development_plans" ADD CONSTRAINT "hr_development_plans_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_attendance" ADD CONSTRAINT "hr_attendance_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_work_schedules" ADD CONSTRAINT "hr_work_schedules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_allowances" ADD CONSTRAINT "hr_leave_allowances_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_allowances" ADD CONSTRAINT "hr_leave_allowances_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_allowances" ADD CONSTRAINT "hr_leave_allowances_leave_type_id_company_id_fkey" FOREIGN KEY ("leave_type_id", "company_id") REFERENCES "hr_leave_types"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_leave_type_id_company_id_fkey" FOREIGN KEY ("leave_type_id", "company_id") REFERENCES "hr_leave_types"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_holidays" ADD CONSTRAINT "hr_holidays_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policies" ADD CONSTRAINT "hr_policies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_acks" ADD CONSTRAINT "hr_policy_acks_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_acks" ADD CONSTRAINT "hr_policy_acks_policy_id_company_id_fkey" FOREIGN KEY ("policy_id", "company_id") REFERENCES "hr_policies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_policy_acks" ADD CONSTRAINT "hr_policy_acks_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_requests" ADD CONSTRAINT "hr_employee_requests_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employee_requests" ADD CONSTRAINT "hr_employee_requests_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_structures" ADD CONSTRAINT "hr_salary_structures_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_components" ADD CONSTRAINT "hr_salary_components_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_salary_components" ADD CONSTRAINT "hr_salary_components_structure_id_company_id_fkey" FOREIGN KEY ("structure_id", "company_id") REFERENCES "hr_salary_structures"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_compensations" ADD CONSTRAINT "hr_compensations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_compensations" ADD CONSTRAINT "hr_compensations_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_compensations" ADD CONSTRAINT "hr_compensations_structure_id_company_id_fkey" FOREIGN KEY ("structure_id", "company_id") REFERENCES "hr_salary_structures"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_pay_periods" ADD CONSTRAINT "hr_pay_periods_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payroll_runs" ADD CONSTRAINT "hr_payroll_runs_period_id_company_id_fkey" FOREIGN KEY ("period_id", "company_id") REFERENCES "hr_pay_periods"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_run_id_company_id_fkey" FOREIGN KEY ("run_id", "company_id") REFERENCES "hr_payroll_runs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_employee_id_company_id_fkey" FOREIGN KEY ("employee_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslip_lines" ADD CONSTRAINT "hr_payslip_lines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_payslip_lines" ADD CONSTRAINT "hr_payslip_lines_payslip_id_company_id_fkey" FOREIGN KEY ("payslip_id", "company_id") REFERENCES "hr_payslips"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_connection_id_company_id_fkey" FOREIGN KEY ("connection_id", "company_id") REFERENCES "integration_connections"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_hooks" ADD CONSTRAINT "integration_hooks_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_hook_deliveries" ADD CONSTRAINT "integration_hook_deliveries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_hook_deliveries" ADD CONSTRAINT "integration_hook_deliveries_hook_id_company_id_fkey" FOREIGN KEY ("hook_id", "company_id") REFERENCES "integration_hooks"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_subscriptions" ADD CONSTRAINT "integration_webhook_subscriptions_company_id_organization__fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_deliveries" ADD CONSTRAINT "integration_webhook_deliveries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_deliveries" ADD CONSTRAINT "integration_webhook_deliveries_subscription_id_company_id_fkey" FOREIGN KEY ("subscription_id", "company_id") REFERENCES "integration_webhook_subscriptions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_segment_id_company_id_fkey" FOREIGN KEY ("segment_id", "company_id") REFERENCES "marketing_segments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_spend" ADD CONSTRAINT "marketing_spend_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_spend" ADD CONSTRAINT "marketing_spend_campaign_id_company_id_fkey" FOREIGN KEY ("campaign_id", "company_id") REFERENCES "marketing_campaigns"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_segments" ADD CONSTRAINT "marketing_segments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_segment_members" ADD CONSTRAINT "marketing_segment_members_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_segment_members" ADD CONSTRAINT "marketing_segment_members_segment_id_company_id_fkey" FOREIGN KEY ("segment_id", "company_id") REFERENCES "marketing_segments"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_segment_members" ADD CONSTRAINT "marketing_segment_members_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_suppressions" ADD CONSTRAINT "marketing_suppressions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_campaign_id_company_id_fkey" FOREIGN KEY ("campaign_id", "company_id") REFERENCES "marketing_campaigns"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content_versions" ADD CONSTRAINT "marketing_content_versions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content_versions" ADD CONSTRAINT "marketing_content_versions_content_id_company_id_fkey" FOREIGN KEY ("content_id", "company_id") REFERENCES "marketing_content"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content_comments" ADD CONSTRAINT "marketing_content_comments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content_comments" ADD CONSTRAINT "marketing_content_comments_content_id_company_id_fkey" FOREIGN KEY ("content_id", "company_id") REFERENCES "marketing_content"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_accounts" ADD CONSTRAINT "marketing_social_accounts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_posts" ADD CONSTRAINT "marketing_social_posts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_posts" ADD CONSTRAINT "marketing_social_posts_campaign_id_company_id_fkey" FOREIGN KEY ("campaign_id", "company_id") REFERENCES "marketing_campaigns"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_posts" ADD CONSTRAINT "marketing_social_posts_content_id_company_id_fkey" FOREIGN KEY ("content_id", "company_id") REFERENCES "marketing_content"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_post_targets" ADD CONSTRAINT "marketing_social_post_targets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_post_targets" ADD CONSTRAINT "marketing_social_post_targets_post_id_company_id_fkey" FOREIGN KEY ("post_id", "company_id") REFERENCES "marketing_social_posts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_post_targets" ADD CONSTRAINT "marketing_social_post_targets_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "marketing_social_accounts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_metric_snapshots" ADD CONSTRAINT "marketing_social_metric_snapshots_company_id_organization__fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_social_metric_snapshots" ADD CONSTRAINT "marketing_social_metric_snapshots_target_id_company_id_fkey" FOREIGN KEY ("target_id", "company_id") REFERENCES "marketing_social_post_targets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_projects" ADD CONSTRAINT "seo_projects_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "seo_projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_rank_snapshots" ADD CONSTRAINT "seo_rank_snapshots_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_rank_snapshots" ADD CONSTRAINT "seo_rank_snapshots_keyword_id_company_id_fkey" FOREIGN KEY ("keyword_id", "company_id") REFERENCES "seo_keywords"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_competitors" ADD CONSTRAINT "seo_competitors_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_competitors" ADD CONSTRAINT "seo_competitors_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "seo_projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audits" ADD CONSTRAINT "seo_audits_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audits" ADD CONSTRAINT "seo_audits_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "seo_projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_templates" ADD CONSTRAINT "marketing_email_templates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_campaigns" ADD CONSTRAINT "marketing_email_campaigns_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_campaigns" ADD CONSTRAINT "marketing_email_campaigns_campaign_id_company_id_fkey" FOREIGN KEY ("campaign_id", "company_id") REFERENCES "marketing_campaigns"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_campaigns" ADD CONSTRAINT "marketing_email_campaigns_template_id_company_id_fkey" FOREIGN KEY ("template_id", "company_id") REFERENCES "marketing_email_templates"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_campaigns" ADD CONSTRAINT "marketing_email_campaigns_segment_id_company_id_fkey" FOREIGN KEY ("segment_id", "company_id") REFERENCES "marketing_segments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_sends" ADD CONSTRAINT "marketing_email_sends_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_sends" ADD CONSTRAINT "marketing_email_sends_email_campaign_id_company_id_fkey" FOREIGN KEY ("email_campaign_id", "company_id") REFERENCES "marketing_email_campaigns"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_sends" ADD CONSTRAINT "marketing_email_sends_enrollment_id_company_id_fkey" FOREIGN KEY ("enrollment_id", "company_id") REFERENCES "marketing_sequence_enrollments"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_events" ADD CONSTRAINT "marketing_email_events_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_events" ADD CONSTRAINT "marketing_email_events_send_id_company_id_fkey" FOREIGN KEY ("send_id", "company_id") REFERENCES "marketing_email_sends"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_sequences" ADD CONSTRAINT "marketing_sequences_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_sequences" ADD CONSTRAINT "marketing_sequences_trigger_form_id_company_id_fkey" FOREIGN KEY ("trigger_form_id", "company_id") REFERENCES "marketing_forms"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_sequence_steps" ADD CONSTRAINT "marketing_sequence_steps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_sequence_steps" ADD CONSTRAINT "marketing_sequence_steps_sequence_id_company_id_fkey" FOREIGN KEY ("sequence_id", "company_id") REFERENCES "marketing_sequences"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_sequence_enrollments" ADD CONSTRAINT "marketing_sequence_enrollments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_sequence_enrollments" ADD CONSTRAINT "marketing_sequence_enrollments_sequence_id_company_id_fkey" FOREIGN KEY ("sequence_id", "company_id") REFERENCES "marketing_sequences"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_forms" ADD CONSTRAINT "marketing_forms_campaign_id_company_id_fkey" FOREIGN KEY ("campaign_id", "company_id") REFERENCES "marketing_campaigns"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_form_submissions" ADD CONSTRAINT "marketing_form_submissions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_form_submissions" ADD CONSTRAINT "marketing_form_submissions_form_id_company_id_fkey" FOREIGN KEY ("form_id", "company_id") REFERENCES "marketing_forms"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_publishers" ADD CONSTRAINT "marketplace_publishers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "marketplace_publishers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listing_versions" ADD CONSTRAINT "marketplace_listing_versions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_installations" ADD CONSTRAINT "marketplace_installations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_install_items" ADD CONSTRAINT "marketplace_install_items_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_install_items" ADD CONSTRAINT "marketplace_install_items_installation_id_company_id_fkey" FOREIGN KEY ("installation_id", "company_id") REFERENCES "marketplace_installations"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "leads"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_company_id_fkey" FOREIGN KEY ("parent_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_id_company_id_fkey" FOREIGN KEY ("head_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_id_company_id_fkey" FOREIGN KEY ("lead_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_id_company_id_fkey" FOREIGN KEY ("team_id", "company_id") REFERENCES "teams"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_company_id_fkey" FOREIGN KEY ("manager_id", "company_id") REFERENCES "employees"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_company_id_fkey" FOREIGN KEY ("designation_id", "company_id") REFERENCES "hr_designations"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_schedule_id_company_id_fkey" FOREIGN KEY ("work_schedule_id", "company_id") REFERENCES "hr_work_schedules"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_parent_id_company_id_fkey" FOREIGN KEY ("parent_id", "company_id") REFERENCES "work_tasks"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_sprint_id_company_id_fkey" FOREIGN KEY ("sprint_id", "company_id") REFERENCES "sprints"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_milestone_id_company_id_fkey" FOREIGN KEY ("milestone_id", "company_id") REFERENCES "project_milestones"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_feature_id_company_id_fkey" FOREIGN KEY ("feature_id", "company_id") REFERENCES "product_features"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_settings" ADD CONSTRAINT "support_settings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_categories" ADD CONSTRAINT "support_categories_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sla_policies" ADD CONSTRAINT "support_sla_policies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sla_targets" ADD CONSTRAINT "support_sla_targets_policy_id_company_id_fkey" FOREIGN KEY ("policy_id", "company_id") REFERENCES "support_sla_policies"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_id_company_id_fkey" FOREIGN KEY ("requester_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "support_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_sla_policy_id_company_id_fkey" FOREIGN KEY ("sla_policy_id", "company_id") REFERENCES "support_sla_policies"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_company_id_fkey" FOREIGN KEY ("ticket_id", "company_id") REFERENCES "support_tickets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticket_id_company_id_fkey" FOREIGN KEY ("ticket_id", "company_id") REFERENCES "support_tickets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_company_id_fkey" FOREIGN KEY ("message_id", "company_id") REFERENCES "support_messages"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_assignment_rules" ADD CONSTRAINT "support_assignment_rules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_escalation_rules" ADD CONSTRAINT "support_escalation_rules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_kb_categories" ADD CONSTRAINT "support_kb_categories_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_kb_articles" ADD CONSTRAINT "support_kb_articles_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_kb_articles" ADD CONSTRAINT "support_kb_articles_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "support_kb_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risks" ADD CONSTRAINT "project_risks_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_dependencies" ADD CONSTRAINT "work_task_dependencies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_dependencies" ADD CONSTRAINT "work_task_dependencies_task_id_company_id_fkey" FOREIGN KEY ("task_id", "company_id") REFERENCES "work_tasks"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_dependencies" ADD CONSTRAINT "work_task_dependencies_depends_on_id_company_id_fkey" FOREIGN KEY ("depends_on_id", "company_id") REFERENCES "work_tasks"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_comments" ADD CONSTRAINT "work_task_comments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_comments" ADD CONSTRAINT "work_task_comments_task_id_company_id_fkey" FOREIGN KEY ("task_id", "company_id") REFERENCES "work_tasks"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_attachments" ADD CONSTRAINT "work_task_attachments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_attachments" ADD CONSTRAINT "work_task_attachments_task_id_company_id_fkey" FOREIGN KEY ("task_id", "company_id") REFERENCES "work_tasks"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_entries" ADD CONSTRAINT "work_time_entries_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_entries" ADD CONSTRAINT "work_time_entries_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_time_entries" ADD CONSTRAINT "work_time_entries_task_id_company_id_fkey" FOREIGN KEY ("task_id", "company_id") REFERENCES "work_tasks"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_retro_items" ADD CONSTRAINT "sprint_retro_items_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_retro_items" ADD CONSTRAINT "sprint_retro_items_sprint_id_company_id_fkey" FOREIGN KEY ("sprint_id", "company_id") REFERENCES "sprints"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_initiatives" ADD CONSTRAINT "product_initiatives_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_initiative_id_company_id_fkey" FOREIGN KEY ("initiative_id", "company_id") REFERENCES "product_initiatives"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_features" ADD CONSTRAINT "product_features_release_id_company_id_fkey" FOREIGN KEY ("release_id", "company_id") REFERENCES "product_releases"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ideas" ADD CONSTRAINT "product_ideas_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ideas" ADD CONSTRAINT "product_ideas_feature_id_company_id_fkey" FOREIGN KEY ("feature_id", "company_id") REFERENCES "product_features"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_idea_votes" ADD CONSTRAINT "product_idea_votes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_idea_votes" ADD CONSTRAINT "product_idea_votes_idea_id_company_id_fkey" FOREIGN KEY ("idea_id", "company_id") REFERENCES "product_ideas"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_feature_id_company_id_fkey" FOREIGN KEY ("feature_id", "company_id") REFERENCES "product_features"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_processes" ADD CONSTRAINT "ops_processes_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_process_versions" ADD CONSTRAINT "ops_process_versions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_process_versions" ADD CONSTRAINT "ops_process_versions_process_id_company_id_fkey" FOREIGN KEY ("process_id", "company_id") REFERENCES "ops_processes"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_checklists" ADD CONSTRAINT "ops_checklists_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_checklist_runs" ADD CONSTRAINT "ops_checklist_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_checklist_runs" ADD CONSTRAINT "ops_checklist_runs_checklist_id_company_id_fkey" FOREIGN KEY ("checklist_id", "company_id") REFERENCES "ops_checklists"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_assets" ADD CONSTRAINT "ops_assets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_incidents" ADD CONSTRAINT "ops_incidents_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_incidents" ADD CONSTRAINT "ops_incidents_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employees" ADD CONSTRAINT "ai_employees_runs_as_user_id_fkey" FOREIGN KEY ("runs_as_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employee_memories" ADD CONSTRAINT "ai_employee_memories_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_employee_memories" ADD CONSTRAINT "ai_employee_memories_ai_employee_id_company_id_fkey" FOREIGN KEY ("ai_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_schedules" ADD CONSTRAINT "ai_schedules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_schedules" ADD CONSTRAINT "ai_schedules_ai_employee_id_company_id_fkey" FOREIGN KEY ("ai_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_schedule_runs" ADD CONSTRAINT "ai_schedule_runs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_schedule_runs" ADD CONSTRAINT "ai_schedule_runs_schedule_id_company_id_fkey" FOREIGN KEY ("schedule_id", "company_id") REFERENCES "ai_schedules"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_briefings" ADD CONSTRAINT "ai_briefings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
