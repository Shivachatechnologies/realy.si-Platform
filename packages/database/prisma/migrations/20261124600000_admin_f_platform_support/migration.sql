-- CreateEnum
CREATE TYPE "PlatformTicketStatus" AS ENUM ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'ON_HOLD', 'SOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlatformTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "platform_support_tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "organization_id" UUID,
    "requester_id" UUID,
    "requester_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT,
    "status" "PlatformTicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "PlatformTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "assignee_id" UUID,
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "incident_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sla_due_at" TIMESTAMPTZ(3),
    "first_response_at" TIMESTAMPTZ(3),
    "last_customer_at" TIMESTAMPTZ(3),
    "solved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "email_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "api_key_id" UUID,
    "app" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "request_id" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_events" (
    "id" UUID NOT NULL,
    "rule" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "route" TEXT,
    "limit" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "email_message_id" UUID,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "feature_flag_rollouts" (
    "flag_id" UUID NOT NULL,
    "percentage" INTEGER,
    "environments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "killed_at" TIMESTAMPTZ(3),
    "killed_by_id" UUID,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flag_rollouts_pkey" PRIMARY KEY ("flag_id")
);

-- CreateTable
CREATE TABLE "feature_flag_versions" (
    "id" UUID NOT NULL,
    "flag_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_deletion_requests" (
    "id" UUID NOT NULL,
    "store" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "organization_id" UUID,
    "file_meta" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by_id" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_support_tickets_number_key" ON "platform_support_tickets"("number");

-- CreateIndex
CREATE INDEX "platform_support_tickets_status_priority_updated_at_idx" ON "platform_support_tickets"("status", "priority", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "platform_support_tickets_organization_id_created_at_idx" ON "platform_support_tickets"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_support_tickets_requester_id_created_at_idx" ON "platform_support_tickets"("requester_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "platform_support_tickets_assignee_id_status_idx" ON "platform_support_tickets"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "platform_support_tickets_sla_due_at_idx" ON "platform_support_tickets"("sla_due_at");

-- CreateIndex
CREATE INDEX "platform_support_messages_ticket_id_created_at_idx" ON "platform_support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "api_request_logs_created_at_idx" ON "api_request_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "api_request_logs_organization_id_created_at_idx" ON "api_request_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "api_request_logs_api_key_id_created_at_idx" ON "api_request_logs"("api_key_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "api_request_logs_status_created_at_idx" ON "api_request_logs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "rate_limit_events_created_at_idx" ON "rate_limit_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "rate_limit_events_rule_created_at_idx" ON "rate_limit_events"("rule", "created_at" DESC);

-- CreateIndex
CREATE INDEX "email_events_recipient_occurred_at_idx" ON "email_events"("recipient", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "email_events_type_occurred_at_idx" ON "email_events"("type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "email_events_provider_message_id_idx" ON "email_events"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_events_provider_provider_message_id_type_occurred_at_key" ON "email_events"("provider", "provider_message_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "email_suppressions_created_at_idx" ON "email_suppressions"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_versions_flag_id_version_key" ON "feature_flag_versions"("flag_id", "version");

-- CreateIndex
CREATE INDEX "file_deletion_requests_status_created_at_idx" ON "file_deletion_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "file_deletion_requests_store_file_id_idx" ON "file_deletion_requests"("store", "file_id");

-- AddForeignKey
ALTER TABLE "platform_support_messages" ADD CONSTRAINT "platform_support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "platform_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

