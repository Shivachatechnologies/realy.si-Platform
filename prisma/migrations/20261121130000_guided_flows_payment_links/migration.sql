-- Guided flow progress (sales/finance journeys) and invoice payment links. Additive only.
BEGIN;


-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "payment_link_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_link_id" TEXT,
ADD COLUMN     "payment_link_provider" TEXT,
ADD COLUMN     "payment_link_url" TEXT;

-- CreateTable
CREATE TABLE "guided_flow_progress" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "flow" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "guided_flow_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guided_flow_progress_company_id_flow_key" ON "guided_flow_progress"("company_id", "flow");

-- AddForeignKey
ALTER TABLE "guided_flow_progress" ADD CONSTRAINT "guided_flow_progress_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
