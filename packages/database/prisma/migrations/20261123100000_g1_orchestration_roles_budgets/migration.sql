-- AlterEnum
ALTER TYPE "AgentTaskStatus" ADD VALUE 'WAITING_APPROVAL';

-- AlterEnum
ALTER TYPE "AiScheduleFrequency" ADD VALUE 'MONTHLY';

-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "resume_state" JSONB;

-- AlterTable
ALTER TABLE "ai_schedules" ADD COLUMN     "day_of_month" INTEGER;

-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "command_run_id" UUID,
ADD COLUMN     "last_attempt_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "company_goals" ADD COLUMN     "budget_currency" CHAR(3),
ADD COLUMN     "budget_minor" BIGINT;

-- AlterTable
ALTER TABLE "objective_initiatives" ADD COLUMN     "budget_currency" CHAR(3),
ADD COLUMN     "budget_minor" BIGINT;

-- CreateTable
CREATE TABLE "ai_role_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "tools" TEXT[],
    "max_turns" INTEGER NOT NULL DEFAULT 8,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_role_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_role_profiles_organization_id_company_id_archived_at_idx" ON "ai_role_profiles"("organization_id", "company_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_role_profiles_company_id_key_key" ON "ai_role_profiles"("company_id", "key");

-- CreateIndex
CREATE INDEX "approvals_command_run_id_idx" ON "approvals"("command_run_id");

-- AddForeignKey
ALTER TABLE "ai_role_profiles" ADD CONSTRAINT "ai_role_profiles_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

