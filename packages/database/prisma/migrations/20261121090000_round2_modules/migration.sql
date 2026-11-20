-- Round 2: CRM proposals/sales tasks, finance AP/approvals/budget alerts, goals & key results & strategy, company brain links & memory,
-- comms discussions/meetings/agenda templates, marketing brand kit, automation counters/dead letters, integration logs. Additive only.
BEGIN;


-- CreateEnum
CREATE TYPE "BrainLinkSubject" AS ENUM ('GRAPH_ENTITY', 'ACCOUNT', 'CONTACT', 'PROJECT');

-- CreateEnum
CREATE TYPE "CompanyMemoryAuthor" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "CommsMeetingRecurrence" AS ENUM ('WEEKLY', 'BIWEEKLY');

-- CreateEnum
CREATE TYPE "CommsRsvp" AS ENUM ('PENDING', 'ACCEPTED', 'TENTATIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "CrmProposalStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FinanceBillStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "FinanceApprovalKind" AS ENUM ('BILL', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinanceApproverMode" AS ENUM ('FINANCE_MANAGERS', 'DEPARTMENT_HEAD', 'USER');

-- CreateEnum
CREATE TYPE "FinanceExpenseClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompanyGoalHorizon" AS ENUM ('QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "CompanyGoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "KeyResultSource" AS ENUM ('METRIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "KeyResultDirection" AS ENUM ('INCREASE', 'DECREASE');

-- AlterEnum

-- This migration adds more than one value to an enum.

-- With PostgreSQL versions 11 and earlier, this is not possible

-- in a single migration. This can be worked around by creating

-- multiple migrations, each migration adding only one value to

-- the enum.
ALTER TYPE "FinanceTxnSource" ADD VALUE 'BILL_PAYMENT';
ALTER TYPE "FinanceTxnSource" ADD VALUE 'EXPENSE_CLAIM';

-- AlterEnum

-- This migration adds more than one value to an enum.

-- With PostgreSQL versions 11 and earlier, this is not possible

-- in a single migration. This can be worked around by creating

-- multiple migrations, each migration adding only one value to

-- the enum.
ALTER TYPE "JournalSource" ADD VALUE 'BILL';
ALTER TYPE "JournalSource" ADD VALUE 'BILL_PAYMENT';

-- AlterTable
ALTER TABLE "workflow_runs" ADD COLUMN     "dead_lettered_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "workflow_approval_requests" ADD COLUMN     "approver_mode" TEXT NOT NULL DEFAULT 'users',
ADD COLUMN     "approver_permission" TEXT,
ADD COLUMN     "escalate_to_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "escalated_at" TIMESTAMPTZ(3),
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "timeout_action" TEXT,
ADD COLUMN     "timeout_hours" INTEGER;

-- AlterTable
ALTER TABLE "comms_messages" ADD COLUMN     "task_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "comms_meetings" ADD COLUMN     "follow_up_result" JSONB,
ADD COLUMN     "follow_up_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "recurrence" "CommsMeetingRecurrence",
ADD COLUMN     "series_id" UUID;

-- AlterTable
ALTER TABLE "comms_meeting_attendees" ADD COLUMN     "responded_at" TIMESTAMPTZ(3),
ADD COLUMN     "rsvp" "CommsRsvp" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "brain_documents" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" TEXT,
ADD COLUMN     "source_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "objectives" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "goal_id" UUID,
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "start_date" DATE;

-- AlterTable
ALTER TABLE "crm_assignment_rules" ADD COLUMN     "follow_up_days" INTEGER,
ADD COLUMN     "follow_up_note" TEXT;

-- AlterTable
ALTER TABLE "crm_stage_rules" ADD COLUMN     "work_task_due_days" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "work_task_priority" "WorkPriority" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "finance_transactions" ADD COLUMN     "bill_payment_id" UUID,
ADD COLUMN     "project_id" UUID;

-- CreateTable
CREATE TABLE "workflow_counters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "workflow_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "subject_type" "BrainLinkSubject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brain_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_memories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "source" TEXT,
    "department_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "author_kind" "CompanyMemoryAuthor" NOT NULL DEFAULT 'HUMAN',
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_task_discussions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comms_task_discussions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_agenda_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "comms_agenda_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "crm_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "deal_id" UUID NOT NULL,
    "account_id" UUID,
    "contact_id" UUID,
    "owner_id" UUID,
    "title" TEXT NOT NULL,
    "intro" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "timeline" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "valid_until" DATE,
    "status" "CrmProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "share_token" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "sent_to" TEXT,
    "viewed_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "decided_at" TIMESTAMPTZ(3),
    "decision_name" TEXT,
    "decision_note" TEXT,
    "decision_ip" TEXT,
    "decision_user_agent" TEXT,
    "create_estimate_on_accept" BOOLEAN NOT NULL DEFAULT false,
    "estimate_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "crm_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity_milli" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_bps" INTEGER NOT NULL DEFAULT 0,
    "net_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_proposal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_revisions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_proposal_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_sends" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_proposal_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales_reps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "max_open_deals" INTEGER,
    "max_open_leads" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "crm_sales_reps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_bills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "FinanceBillStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "overdue_notified_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_bill_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity_milli" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "category_id" UUID,
    "department_id" UUID,
    "project_id" UUID,
    "tax_rate_id" UUID,
    "tax_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "net_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    CONSTRAINT "finance_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_bill_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "method" "InvoicePaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "finance_account_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_doc_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bill_id" UUID,
    "expense_claim_id" UUID,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_doc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_approval_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceApprovalKind",
    "min_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "department_id" UUID,
    "category_id" UUID,
    "approver_mode" "FinanceApproverMode" NOT NULL DEFAULT 'FINANCE_MANAGERS',
    "approver_user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_approval_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "FinanceApprovalKind" NOT NULL,
    "bill_id" UUID,
    "expense_claim_id" UUID,
    "rule_id" UUID,
    "title" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "FinanceApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "approver_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_expense_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID,
    "department_id" UUID,
    "project_id" UUID,
    "merchant" TEXT,
    "notes" TEXT,
    "status" "FinanceExpenseClaimStatus" NOT NULL DEFAULT 'PENDING',
    "finance_account_id" UUID,
    "transaction_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "finance_expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budget_alerts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "threshold" INTEGER NOT NULL,
    "period_key" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finance_budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_request_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "request_summary" TEXT,
    "response_summary" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_external_refs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "internal_type" TEXT NOT NULL,
    "internal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_brand_kits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "tagline" TEXT,
    "voice_tone" TEXT,
    "messaging_pillars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "do_words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dont_words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personas" JSONB NOT NULL DEFAULT '[]',
    "colors" JSONB NOT NULL DEFAULT '[]',
    "logo_url" TEXT,
    "logo_dark_url" TEXT,
    "icon_url" TEXT,
    "heading_font" TEXT,
    "body_font" TEXT,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_strategies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mission" TEXT,
    "vision" TEXT,
    "values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_pillars" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "strategy_pillars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "horizon" "CompanyGoalHorizon" NOT NULL DEFAULT 'QUARTER',
    "status" "CompanyGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_id" UUID,
    "pillar_id" UUID,
    "target_date" DATE,
    "plan_task_id" UUID,
    "plan_applied" JSONB NOT NULL DEFAULT '{}',
    "plan_applied_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "company_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_key_results" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source" "KeyResultSource" NOT NULL DEFAULT 'MANUAL',
    "metric_key" TEXT,
    "unit" TEXT,
    "baseline" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION,
    "direction" "KeyResultDirection" NOT NULL DEFAULT 'INCREASE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "objective_key_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_counters_workflow_id_key_key" ON "workflow_counters"("workflow_id", "key");

-- CreateIndex
CREATE INDEX "brain_links_company_id_subject_type_subject_id_idx" ON "brain_links"("company_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_links_document_id_subject_type_subject_id_key" ON "brain_links"("document_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "company_memories_organization_id_company_id_pinned_idx" ON "company_memories"("organization_id", "company_id", "pinned");

-- CreateIndex
CREATE INDEX "company_memories_company_id_department_id_idx" ON "company_memories"("company_id", "department_id");

-- CreateIndex
CREATE INDEX "comms_task_discussions_channel_id_idx" ON "comms_task_discussions"("channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_task_discussions_company_id_task_id_key" ON "comms_task_discussions"("company_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "comms_agenda_templates_company_id_name_key" ON "comms_agenda_templates"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sequences_company_id_key_key" ON "crm_sequences"("company_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_share_token_key" ON "crm_proposals"("share_token");

-- CreateIndex
CREATE INDEX "crm_proposals_organization_id_company_id_status_idx" ON "crm_proposals"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "crm_proposals_deal_id_idx" ON "crm_proposals"("deal_id");

-- CreateIndex
CREATE INDEX "crm_proposals_contact_id_idx" ON "crm_proposals"("contact_id");

-- CreateIndex
CREATE INDEX "crm_proposals_account_id_idx" ON "crm_proposals"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_id_company_id_key" ON "crm_proposals"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_company_id_number_key" ON "crm_proposals"("company_id", "number");

-- CreateIndex
CREATE INDEX "crm_proposal_lines_proposal_id_position_idx" ON "crm_proposal_lines"("proposal_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposal_revisions_proposal_id_version_key" ON "crm_proposal_revisions"("proposal_id", "version");

-- CreateIndex
CREATE INDEX "crm_proposal_sends_company_id_to_email_idx" ON "crm_proposal_sends"("company_id", "to_email");

-- CreateIndex
CREATE INDEX "crm_proposal_sends_proposal_id_sent_at_idx" ON "crm_proposal_sends"("proposal_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_sales_reps_company_id_owner_id_key" ON "crm_sales_reps"("company_id", "owner_id");

-- CreateIndex
CREATE INDEX "finance_bills_organization_id_company_id_status_idx" ON "finance_bills"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "finance_bills_company_id_due_date_idx" ON "finance_bills"("company_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_bills_id_company_id_key" ON "finance_bills"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_bills_company_id_vendor_id_number_key" ON "finance_bills"("company_id", "vendor_id", "number");

-- CreateIndex
CREATE INDEX "finance_bill_lines_bill_id_idx" ON "finance_bill_lines"("bill_id");

-- CreateIndex
CREATE INDEX "finance_bill_lines_company_id_department_id_idx" ON "finance_bill_lines"("company_id", "department_id");

-- CreateIndex
CREATE INDEX "finance_bill_lines_company_id_project_id_idx" ON "finance_bill_lines"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "finance_bill_payments_bill_id_idx" ON "finance_bill_payments"("bill_id");

-- CreateIndex
CREATE INDEX "finance_bill_payments_company_id_date_idx" ON "finance_bill_payments"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "finance_doc_attachments_bill_id_key" ON "finance_doc_attachments"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_doc_attachments_expense_claim_id_key" ON "finance_doc_attachments"("expense_claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_doc_attachments_bill_id_company_id_key" ON "finance_doc_attachments"("bill_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_doc_attachments_expense_claim_id_company_id_key" ON "finance_doc_attachments"("expense_claim_id", "company_id");

-- CreateIndex
CREATE INDEX "finance_approval_rules_company_id_active_idx" ON "finance_approval_rules"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "finance_approval_rules_id_company_id_key" ON "finance_approval_rules"("id", "company_id");

-- CreateIndex
CREATE INDEX "finance_approval_requests_organization_id_company_id_status_idx" ON "finance_approval_requests"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "finance_approval_requests_bill_id_idx" ON "finance_approval_requests"("bill_id");

-- CreateIndex
CREATE INDEX "finance_approval_requests_expense_claim_id_idx" ON "finance_approval_requests"("expense_claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_claims_transaction_id_key" ON "finance_expense_claims"("transaction_id");

-- CreateIndex
CREATE INDEX "finance_expense_claims_organization_id_company_id_status_idx" ON "finance_expense_claims"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "finance_expense_claims_company_id_requester_id_idx" ON "finance_expense_claims"("company_id", "requester_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_expense_claims_id_company_id_key" ON "finance_expense_claims"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_budget_alerts_budget_id_threshold_period_key_key" ON "finance_budget_alerts"("budget_id", "threshold", "period_key");

-- CreateIndex
CREATE INDEX "integration_request_logs_connection_id_created_at_idx" ON "integration_request_logs"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_request_logs_organization_id_company_id_created_idx" ON "integration_request_logs"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_external_refs_connection_id_kind_external_id_key" ON "integration_external_refs"("connection_id", "kind", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_brand_kits_company_id_key" ON "marketing_brand_kits"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_strategies_company_id_key" ON "company_strategies"("company_id");

-- CreateIndex
CREATE INDEX "strategy_pillars_company_id_position_idx" ON "strategy_pillars"("company_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_pillars_id_company_id_key" ON "strategy_pillars"("id", "company_id");

-- CreateIndex
CREATE INDEX "company_goals_organization_id_company_id_status_idx" ON "company_goals"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_goals_id_company_id_key" ON "company_goals"("id", "company_id");

-- CreateIndex
CREATE INDEX "objective_key_results_objective_id_position_idx" ON "objective_key_results"("objective_id", "position");

-- CreateIndex
CREATE INDEX "workflow_runs_organization_id_company_id_dead_lettered_at_idx" ON "workflow_runs"("organization_id", "company_id", "dead_lettered_at");

-- CreateIndex
CREATE INDEX "workflow_approval_requests_status_expires_at_idx" ON "workflow_approval_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "comms_meetings_series_id_starts_at_idx" ON "comms_meetings"("series_id", "starts_at");

-- CreateIndex
CREATE INDEX "brain_documents_company_id_department_id_idx" ON "brain_documents"("company_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "brain_documents_company_id_source_type_source_id_key" ON "brain_documents"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "objectives_goal_id_idx" ON "objectives"("goal_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_bill_payment_id_key" ON "finance_transactions"("bill_payment_id");

-- CreateIndex
CREATE INDEX "finance_transactions_company_id_project_id_idx" ON "finance_transactions"("company_id", "project_id");

-- AddForeignKey
ALTER TABLE "workflow_counters" ADD CONSTRAINT "workflow_counters_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_counters" ADD CONSTRAINT "workflow_counters_workflow_id_company_id_fkey" FOREIGN KEY ("workflow_id", "company_id") REFERENCES "workflows"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_links" ADD CONSTRAINT "brain_links_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_links" ADD CONSTRAINT "brain_links_document_id_company_id_fkey" FOREIGN KEY ("document_id", "company_id") REFERENCES "brain_documents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memories" ADD CONSTRAINT "company_memories_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memories" ADD CONSTRAINT "company_memories_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_task_discussions" ADD CONSTRAINT "comms_task_discussions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_task_discussions" ADD CONSTRAINT "comms_task_discussions_channel_id_company_id_fkey" FOREIGN KEY ("channel_id", "company_id") REFERENCES "comms_channels"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_agenda_templates" ADD CONSTRAINT "comms_agenda_templates_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brain_documents" ADD CONSTRAINT "brain_documents_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_goal_id_company_id_fkey" FOREIGN KEY ("goal_id", "company_id") REFERENCES "company_goals"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_deal_id_company_id_fkey" FOREIGN KEY ("deal_id", "company_id") REFERENCES "crm_deals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_account_id_company_id_fkey" FOREIGN KEY ("account_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "contacts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_lines" ADD CONSTRAINT "crm_proposal_lines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_lines" ADD CONSTRAINT "crm_proposal_lines_proposal_id_company_id_fkey" FOREIGN KEY ("proposal_id", "company_id") REFERENCES "crm_proposals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_revisions" ADD CONSTRAINT "crm_proposal_revisions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_revisions" ADD CONSTRAINT "crm_proposal_revisions_proposal_id_company_id_fkey" FOREIGN KEY ("proposal_id", "company_id") REFERENCES "crm_proposals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_sends" ADD CONSTRAINT "crm_proposal_sends_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_sends" ADD CONSTRAINT "crm_proposal_sends_proposal_id_company_id_fkey" FOREIGN KEY ("proposal_id", "company_id") REFERENCES "crm_proposals"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_sales_reps" ADD CONSTRAINT "crm_sales_reps_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bills" ADD CONSTRAINT "finance_bills_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bills" ADD CONSTRAINT "finance_bills_vendor_id_company_id_fkey" FOREIGN KEY ("vendor_id", "company_id") REFERENCES "accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_lines" ADD CONSTRAINT "finance_bill_lines_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_lines" ADD CONSTRAINT "finance_bill_lines_bill_id_company_id_fkey" FOREIGN KEY ("bill_id", "company_id") REFERENCES "finance_bills"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_lines" ADD CONSTRAINT "finance_bill_lines_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "finance_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_lines" ADD CONSTRAINT "finance_bill_lines_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_lines" ADD CONSTRAINT "finance_bill_lines_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_lines" ADD CONSTRAINT "finance_bill_lines_tax_rate_id_company_id_fkey" FOREIGN KEY ("tax_rate_id", "company_id") REFERENCES "finance_tax_rates"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_payments" ADD CONSTRAINT "finance_bill_payments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_payments" ADD CONSTRAINT "finance_bill_payments_bill_id_company_id_fkey" FOREIGN KEY ("bill_id", "company_id") REFERENCES "finance_bills"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_bill_payments" ADD CONSTRAINT "finance_bill_payments_finance_account_id_company_id_fkey" FOREIGN KEY ("finance_account_id", "company_id") REFERENCES "finance_accounts"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_doc_attachments" ADD CONSTRAINT "finance_doc_attachments_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_doc_attachments" ADD CONSTRAINT "finance_doc_attachments_bill_id_company_id_fkey" FOREIGN KEY ("bill_id", "company_id") REFERENCES "finance_bills"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_doc_attachments" ADD CONSTRAINT "finance_doc_attachments_expense_claim_id_company_id_fkey" FOREIGN KEY ("expense_claim_id", "company_id") REFERENCES "finance_expense_claims"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_rules" ADD CONSTRAINT "finance_approval_rules_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_rules" ADD CONSTRAINT "finance_approval_rules_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_rules" ADD CONSTRAINT "finance_approval_rules_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "finance_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_requests" ADD CONSTRAINT "finance_approval_requests_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_requests" ADD CONSTRAINT "finance_approval_requests_bill_id_company_id_fkey" FOREIGN KEY ("bill_id", "company_id") REFERENCES "finance_bills"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_requests" ADD CONSTRAINT "finance_approval_requests_expense_claim_id_company_id_fkey" FOREIGN KEY ("expense_claim_id", "company_id") REFERENCES "finance_expense_claims"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_approval_requests" ADD CONSTRAINT "finance_approval_requests_rule_id_company_id_fkey" FOREIGN KEY ("rule_id", "company_id") REFERENCES "finance_approval_rules"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_claims" ADD CONSTRAINT "finance_expense_claims_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_claims" ADD CONSTRAINT "finance_expense_claims_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "finance_categories"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_claims" ADD CONSTRAINT "finance_expense_claims_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "departments"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_expense_claims" ADD CONSTRAINT "finance_expense_claims_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_alerts" ADD CONSTRAINT "finance_budget_alerts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budget_alerts" ADD CONSTRAINT "finance_budget_alerts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "finance_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_request_logs" ADD CONSTRAINT "integration_request_logs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_request_logs" ADD CONSTRAINT "integration_request_logs_connection_id_company_id_fkey" FOREIGN KEY ("connection_id", "company_id") REFERENCES "integration_connections"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_external_refs" ADD CONSTRAINT "integration_external_refs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_external_refs" ADD CONSTRAINT "integration_external_refs_connection_id_company_id_fkey" FOREIGN KEY ("connection_id", "company_id") REFERENCES "integration_connections"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_brand_kits" ADD CONSTRAINT "marketing_brand_kits_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_strategies" ADD CONSTRAINT "company_strategies_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_pillars" ADD CONSTRAINT "strategy_pillars_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_goals" ADD CONSTRAINT "company_goals_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_goals" ADD CONSTRAINT "company_goals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_goals" ADD CONSTRAINT "company_goals_pillar_id_company_id_fkey" FOREIGN KEY ("pillar_id", "company_id") REFERENCES "strategy_pillars"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_key_results" ADD CONSTRAINT "objective_key_results_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_key_results" ADD CONSTRAINT "objective_key_results_objective_id_company_id_fkey" FOREIGN KEY ("objective_id", "company_id") REFERENCES "objectives"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
