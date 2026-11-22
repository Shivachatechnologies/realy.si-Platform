-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('SUCCESS', 'ERROR', 'FALLBACK', 'REFUSED', 'BUDGET_BLOCKED', 'CACHED');

-- AlterEnum
ALTER TYPE "AgentTaskStatus" ADD VALUE 'PAUSED';

-- CreateTable
CREATE TABLE "ai_request_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "company_id" UUID,
    "user_id" UUID,
    "task_id" UUID,
    "ai_employee_id" UUID,
    "trace_id" TEXT,
    "operation" TEXT NOT NULL,
    "profile" TEXT,
    "department" TEXT,
    "tier" TEXT,
    "provider" TEXT NOT NULL,
    "requested_model" TEXT NOT NULL,
    "served_model" TEXT,
    "status" "AiRequestStatus" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "streamed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_request_logs_created_at_idx" ON "ai_request_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_request_logs_organization_id_created_at_idx" ON "ai_request_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_request_logs_provider_status_created_at_idx" ON "ai_request_logs"("provider", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_request_logs_served_model_created_at_idx" ON "ai_request_logs"("served_model", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_request_logs_task_id_idx" ON "ai_request_logs"("task_id");

-- CreateIndex
CREATE INDEX "ai_request_logs_ai_employee_id_created_at_idx" ON "ai_request_logs"("ai_employee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_request_logs_user_id_created_at_idx" ON "ai_request_logs"("user_id", "created_at" DESC);
