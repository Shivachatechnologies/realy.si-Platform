-- AI tasks executed by the worker. Atomic, see 20261015120000_checkout_sessions.
BEGIN;

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "profile" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "run_token" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "output" TEXT,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_tasks_organization_id_company_id_created_at_idx" ON "agent_tasks"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks"("status");

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Invariants the application also enforces.
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_title_not_blank" CHECK (length(btrim("title")) BETWEEN 1 AND 200);
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_instructions_not_blank" CHECK (length(btrim("instructions")) BETWEEN 1 AND 8000);
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_completed_has_output" CHECK ("status" <> 'COMPLETED' OR "output" IS NOT NULL);

COMMIT;
