-- Approvals for supervised tool calls; objectives and milestones. Additive only. Atomic, see 20261015120000_checkout_sessions.
BEGIN;

-- CreateEnum
CREATE TYPE "ToolRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ToolAutonomy" AS ENUM ('AUTONOMOUS', 'SUPERVISED', 'FOUNDER_ONLY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ObjectiveStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ABANDONED');

-- AlterTable
ALTER TABLE "agent_tasks" ADD COLUMN     "milestone_id" UUID;

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "task_id" UUID,
    "requested_by_profile" TEXT,
    "requested_by_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "tool_version" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "risk" "ToolRisk" NOT NULL,
    "autonomy" "ToolAutonomy" NOT NULL,
    "required_permissions" TEXT[],
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "executed_at" TIMESTAMPTZ(3),
    "result" JSONB,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objectives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "target_date" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "project_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approvals_organization_id_company_id_status_created_at_idx" ON "approvals"("organization_id", "company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approvals_task_id_idx" ON "approvals"("task_id");

-- CreateIndex
CREATE INDEX "approvals_status_expires_at_idx" ON "approvals"("status", "expires_at");

-- CreateIndex
CREATE INDEX "objectives_organization_id_company_id_status_idx" ON "objectives"("organization_id", "company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "objectives_id_company_id_key" ON "objectives"("id", "company_id");

-- CreateIndex
CREATE INDEX "milestones_objective_id_idx" ON "milestones"("objective_id");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_id_company_id_key" ON "milestones"("id", "company_id");

-- CreateIndex
CREATE INDEX "agent_tasks_milestone_id_idx" ON "agent_tasks"("milestone_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tasks_id_company_id_key" ON "agent_tasks"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_company_id_key" ON "projects"("id", "company_id");

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_milestone_id_company_id_fkey" FOREIGN KEY ("milestone_id", "company_id") REFERENCES "milestones"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_company_id_fkey" FOREIGN KEY ("task_id", "company_id") REFERENCES "agent_tasks"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_objective_id_company_id_fkey" FOREIGN KEY ("objective_id", "company_id") REFERENCES "objectives"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Invariants the application also enforces.
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_consistent" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL) OR "status" = 'EXPIRED');
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_summary_not_blank" CHECK (length(btrim("summary")) BETWEEN 1 AND 1000);
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_title_not_blank" CHECK (length(btrim("title")) BETWEEN 1 AND 200);
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_title_not_blank" CHECK (length(btrim("title")) BETWEEN 1 AND 200);

COMMIT;
