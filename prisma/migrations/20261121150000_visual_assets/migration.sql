-- Visual asset library (generated/uploaded artwork per brand, department, campaign, project, AI employee, product). Additive only.
BEGIN;


-- CreateEnum
CREATE TYPE "VisualAssetScope" AS ENUM ('BRAND', 'DEPARTMENT', 'CAMPAIGN', 'PROJECT', 'AI_EMPLOYEE', 'PRODUCT');

-- CreateEnum
CREATE TYPE "VisualAssetKind" AS ENUM ('IMAGE', 'VIDEO', 'SVG');

-- CreateEnum
CREATE TYPE "VisualAssetSource" AS ENUM ('GENERATED', 'UPLOADED');

-- CreateTable
CREATE TABLE "visual_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "scope_type" "VisualAssetScope" NOT NULL DEFAULT 'BRAND',
    "scope_id" UUID,
    "kind" "VisualAssetKind" NOT NULL DEFAULT 'IMAGE',
    "source" "VisualAssetSource" NOT NULL DEFAULT 'GENERATED',
    "title" TEXT,
    "storage_ref" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "prompt" TEXT,
    "style_preset" TEXT,
    "aspect_ratio" TEXT NOT NULL DEFAULT '1:1',
    "width" INTEGER,
    "height" INTEGER,
    "provider" TEXT,
    "model" TEXT,
    "parent_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "visual_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visual_assets_organization_id_company_id_created_at_idx" ON "visual_assets"("organization_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "visual_assets_company_id_scope_type_scope_id_idx" ON "visual_assets"("company_id", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "visual_assets_id_company_id_key" ON "visual_assets"("id", "company_id");

-- AddForeignKey
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_parent_id_company_id_fkey" FOREIGN KEY ("parent_id", "company_id") REFERENCES "visual_assets"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;
