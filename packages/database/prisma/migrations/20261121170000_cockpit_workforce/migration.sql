BEGIN;

-- CreateEnum
CREATE TYPE "AiDelegationStatus" AS ENUM ('PROPOSED', 'CREATED', 'REJECTED', 'FAILED');

-- AlterEnum
ALTER TYPE "AiReportKind" ADD VALUE 'ROLLUP';

-- AlterTable
ALTER TABLE "ai_employees" ADD COLUMN     "monthly_cost_budget_cents" BIGINT;

-- AlterTable
ALTER TABLE "ai_employee_reports" ADD COLUMN     "founder_notified_at" TIMESTAMPTZ(3),
ADD COLUMN     "resolved_at" TIMESTAMPTZ(3),
ADD COLUMN     "resolved_by_id" UUID;

-- CreateTable
CREATE TABLE "guided_drafts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "flow_key" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guided_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_department_budgets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department" TEXT NOT NULL,
    "monthly_token_budget" INTEGER,
    "monthly_cost_budget_cents" BIGINT,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_department_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_delegations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_task_id" UUID NOT NULL,
    "from_employee_id" UUID NOT NULL,
    "to_employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" "AiDelegationStatus" NOT NULL DEFAULT 'PROPOSED',
    "child_task_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guided_drafts_organization_id_company_id_user_id_idx" ON "guided_drafts"("organization_id", "company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "guided_drafts_company_id_user_id_flow_key_key" ON "guided_drafts"("company_id", "user_id", "flow_key");

-- CreateIndex
CREATE INDEX "ai_department_budgets_organization_id_company_id_idx" ON "ai_department_budgets"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_department_budgets_company_id_department_key" ON "ai_department_budgets"("company_id", "department");

-- CreateIndex
CREATE INDEX "ai_delegations_organization_id_company_id_status_created_at_idx" ON "ai_delegations"("organization_id", "company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_delegations_parent_task_id_idx" ON "ai_delegations"("parent_task_id");

-- CreateIndex
CREATE INDEX "ai_employee_reports_company_id_kind_resolved_at_idx" ON "ai_employee_reports"("company_id", "kind", "resolved_at");

-- AddForeignKey
ALTER TABLE "guided_drafts" ADD CONSTRAINT "guided_drafts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guided_drafts" ADD CONSTRAINT "guided_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_department_budgets" ADD CONSTRAINT "ai_department_budgets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_from_employee_id_company_id_fkey" FOREIGN KEY ("from_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_to_employee_id_company_id_fkey" FOREIGN KEY ("to_employee_id", "company_id") REFERENCES "ai_employees"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
