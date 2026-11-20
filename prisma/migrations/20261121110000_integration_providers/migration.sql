-- Integration providers: usage/cost tracking, stored objects, connection health. Additive only.
BEGIN;


-- CreateEnum
CREATE TYPE "IntegrationUsageStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "integration_connections" ADD COLUMN     "error_streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_failure_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_success_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "integration_usage" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "connection_id" UUID,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'request',
    "estimated_cost_micros" INTEGER,
    "status" "IntegrationUsageStatus" NOT NULL,
    "error" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_stored_objects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_stored_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_usage_organization_id_company_id_created_at_idx" ON "integration_usage"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_usage_connection_id_created_at_idx" ON "integration_usage"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_stored_objects_organization_id_company_id_creat_idx" ON "integration_stored_objects"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_stored_objects_company_id_key_key" ON "integration_stored_objects"("company_id", "key");

-- AddForeignKey
ALTER TABLE "integration_usage" ADD CONSTRAINT "integration_usage_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_stored_objects" ADD CONSTRAINT "integration_stored_objects_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
