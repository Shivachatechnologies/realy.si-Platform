BEGIN;

-- CreateEnum
CREATE TYPE "SitePageKind" AS ENUM ('PAGE', 'LANDING');

-- CreateEnum
CREATE TYPE "SitePageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SiteDomainStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "SiteSubmissionStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "theme" JSONB NOT NULL,
    "nav" JSONB NOT NULL DEFAULT '[]',
    "footer" JSONB NOT NULL DEFAULT '{}',
    "seo" JSONB NOT NULL DEFAULT '{}',
    "online" BOOLEAN NOT NULL DEFAULT false,
    "launched_at" TIMESTAMPTZ(3),
    "public_asset_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_domain" TEXT,
    "domain_status" "SiteDomainStatus" NOT NULL DEFAULT 'NONE',
    "domain_token" TEXT,
    "domain_checked_at" TIMESTAMPTZ(3),
    "domain_verified_at" TIMESTAMPTZ(3),
    "domain_error" TEXT,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "kind" "SitePageKind" NOT NULL DEFAULT 'PAGE',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SitePageStatus" NOT NULL DEFAULT 'DRAFT',
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "pending" JSONB,
    "publish_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "live_version" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "show_in_nav" BOOLEAN NOT NULL DEFAULT true,
    "ai_drafted" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_form_submissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "page_id" UUID,
    "block_id" TEXT,
    "page_path" TEXT NOT NULL DEFAULT '',
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "account" TEXT,
    "message" TEXT,
    "consent_text" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "lead_id" UUID,
    "status" "SiteSubmissionStatus" NOT NULL DEFAULT 'NEW',
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_slug_key" ON "sites"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sites_custom_domain_key" ON "sites"("custom_domain");

-- CreateIndex
CREATE INDEX "sites_organization_id_idx" ON "sites"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_id_company_id_key" ON "sites"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_company_id_key" ON "sites"("company_id");

-- CreateIndex
CREATE INDEX "site_pages_company_id_site_id_kind_idx" ON "site_pages"("company_id", "site_id", "kind");

-- CreateIndex
CREATE INDEX "site_pages_status_publish_at_idx" ON "site_pages"("status", "publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_id_company_id_key" ON "site_pages"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_site_id_slug_key" ON "site_pages"("site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_versions_page_id_version_key" ON "site_page_versions"("page_id", "version");

-- CreateIndex
CREATE INDEX "site_form_submissions_company_id_site_id_status_created_at_idx" ON "site_form_submissions"("company_id", "site_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_id_company_id_fkey" FOREIGN KEY ("site_id", "company_id") REFERENCES "sites"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_page_id_company_id_fkey" FOREIGN KEY ("page_id", "company_id") REFERENCES "site_pages"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_form_submissions" ADD CONSTRAINT "site_form_submissions_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_form_submissions" ADD CONSTRAINT "site_form_submissions_site_id_company_id_fkey" FOREIGN KEY ("site_id", "company_id") REFERENCES "sites"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
