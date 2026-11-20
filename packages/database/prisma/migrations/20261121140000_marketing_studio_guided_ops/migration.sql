-- Marketing Studio (autopilot, creative assets, ads, SEO clusters, community, influencers, learnings) and guided
-- HR hiring / project kickoff / support setup. Additive only (new tables, columns and enum values).
BEGIN;


-- CreateEnum
CREATE TYPE "MarketingAutonomy" AS ENUM ('DRAFT_ONLY', 'REVIEW_REQUIRED', 'AUTO_PUBLISH');

-- CreateEnum
CREATE TYPE "MarketingAutopilotStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "MarketingPipelineStage" AS ENUM ('IDEA', 'RESEARCH', 'DRAFT', 'AI_REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'ANALYZED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingAssetKind" AS ENUM ('IMAGE', 'VIDEO', 'LOGO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "MarketingAssetStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- AlterEnum

-- This migration adds more than one value to an enum.

-- With PostgreSQL versions 11 and earlier, this is not possible

-- in a single migration. This can be worked around by creating

-- multiple migrations, each migration adding only one value to

-- the enum.
ALTER TYPE "MarketingContentType" ADD VALUE 'THREADS';
ALTER TYPE "MarketingContentType" ADD VALUE 'TIKTOK_SCRIPT';
ALTER TYPE "MarketingContentType" ADD VALUE 'YOUTUBE_SCRIPT';
ALTER TYPE "MarketingContentType" ADD VALUE 'SEO_ARTICLE';
ALTER TYPE "MarketingContentType" ADD VALUE 'NEWSLETTER';
ALTER TYPE "MarketingContentType" ADD VALUE 'WEBSITE_COPY';
ALTER TYPE "MarketingContentType" ADD VALUE 'CASE_STUDY';
ALTER TYPE "MarketingContentType" ADD VALUE 'PRESS_RELEASE';
ALTER TYPE "MarketingContentType" ADD VALUE 'PRODUCT_ANNOUNCEMENT';
ALTER TYPE "MarketingContentType" ADD VALUE 'THOUGHT_LEADERSHIP';
ALTER TYPE "MarketingContentType" ADD VALUE 'INDUSTRY_REPORT';
ALTER TYPE "MarketingContentType" ADD VALUE 'VIDEO_SCRIPT';
ALTER TYPE "MarketingContentType" ADD VALUE 'CAROUSEL';
ALTER TYPE "MarketingContentType" ADD VALUE 'QUOTE';
ALTER TYPE "MarketingContentType" ADD VALUE 'GRAPHIC_BRIEF';

-- AlterEnum

-- This migration adds more than one value to an enum.

-- With PostgreSQL versions 11 and earlier, this is not possible

-- in a single migration. This can be worked around by creating

-- multiple migrations, each migration adding only one value to

-- the enum.
ALTER TYPE "MarketingSocialProvider" ADD VALUE 'YOUTUBE';
ALTER TYPE "MarketingSocialProvider" ADD VALUE 'TIKTOK';
ALTER TYPE "MarketingSocialProvider" ADD VALUE 'THREADS';
ALTER TYPE "MarketingSocialProvider" ADD VALUE 'PINTEREST';

-- AlterTable
ALTER TABLE "marketing_content" ADD COLUMN     "author_name" TEXT,
ADD COLUMN     "blog_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "cluster_id" UUID,
ADD COLUMN     "featured_asset_id" UUID,
ADD COLUMN     "internal_links" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "parent_id" UUID,
ADD COLUMN     "schema_markup" JSONB,
ADD COLUMN     "seo_project_id" UUID,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "marketing_social_posts" ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "media_asset_id" UUID;

-- AlterTable
ALTER TABLE "marketing_social_post_targets" ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "reach" INTEGER;

-- AlterTable
ALTER TABLE "marketing_social_metric_snapshots" ADD COLUMN     "reach" INTEGER;

-- AlterTable
ALTER TABLE "seo_keywords" ADD COLUMN     "cluster_id" UUID;

-- AlterTable
ALTER TABLE "marketing_email_campaigns" ADD COLUMN     "ab_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ab_metric" TEXT NOT NULL DEFAULT 'open',
ADD COLUMN     "ab_phase" TEXT,
ADD COLUMN     "ab_test_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "ab_test_percent" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "ab_wait_hours" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "ab_winner_variant_id" UUID,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'platform';

-- AlterTable
ALTER TABLE "marketing_email_sends" ADD COLUMN     "bounced_at" TIMESTAMPTZ(3),
ADD COLUMN     "complained_at" TIMESTAMPTZ(3),
ADD COLUMN     "variant_id" UUID;

-- AlterTable
ALTER TABLE "support_settings" ADD COLUMN     "email_channel_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "setup_completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "setup_step" TEXT,
ADD COLUMN     "support_email" TEXT;

-- CreateTable
CREATE TABLE "hr_hiring_journeys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'describe',
    "brief" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "hr_hiring_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_autopilots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand_name" TEXT,
    "objective" TEXT NOT NULL,
    "audience" TEXT,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pillars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cadence" JSONB NOT NULL DEFAULT '{}',
    "account_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "posting_windows" JSONB NOT NULL DEFAULT '{}',
    "autonomy" "MarketingAutonomy" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "approval_rules" JSONB NOT NULL DEFAULT '{}',
    "compliance_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "horizon_days" INTEGER NOT NULL DEFAULT 3,
    "min_review_score" INTEGER NOT NULL DEFAULT 70,
    "monthly_budget_minor" BIGINT,
    "spent_minor" BIGINT NOT NULL DEFAULT 0,
    "spent_month" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "use_research" BOOLEAN NOT NULL DEFAULT true,
    "generate_images" BOOLEAN NOT NULL DEFAULT true,
    "campaign_id" UUID,
    "ai_employee_id" UUID,
    "owner_id" UUID,
    "status" "MarketingAutopilotStatus" NOT NULL DEFAULT 'PAUSED',
    "last_planned_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_autopilots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_autopilot_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "autopilot_id" UUID NOT NULL,
    "platform" "MarketingSocialProvider" NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'post',
    "account_id" UUID,
    "slot_at" TIMESTAMPTZ(3) NOT NULL,
    "stage" "MarketingPipelineStage" NOT NULL DEFAULT 'IDEA',
    "topic" TEXT,
    "angle" TEXT,
    "pillar" TEXT,
    "research" TEXT,
    "assumptions" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "copy" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta" TEXT,
    "creative_brief" TEXT,
    "video_script" TEXT,
    "asset_id" UUID,
    "review" JSONB,
    "review_score" INTEGER,
    "content_hash" TEXT,
    "needs_approval" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "post_id" UUID,
    "content_id" UUID,
    "pending_task_id" UUID,
    "pending_step" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "performance" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_autopilot_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "MarketingAssetKind" NOT NULL,
    "status" "MarketingAssetStatus" NOT NULL DEFAULT 'READY',
    "name" TEXT NOT NULL,
    "mime_type" TEXT,
    "data" BYTEA,
    "size_bytes" INTEGER,
    "url" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "preset" TEXT,
    "provider" TEXT,
    "provider_job_id" TEXT,
    "prompt" TEXT,
    "overlay" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "campaign_id" UUID,
    "parent_id" UUID,
    "error" TEXT,
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_hashtag_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_hashtag_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_learnings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT,
    "key" TEXT NOT NULL,
    "insight" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_learnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_recommendations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT NOT NULL DEFAULT 'loop',
    "href" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_cms_publications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_cms_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_topic_clusters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pillar_keyword" TEXT NOT NULL,
    "intent" TEXT,
    "brief" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "seo_topic_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_search_metrics" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "page" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "seo_search_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_email_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email_campaign_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_email_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ad_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "daily_cap_minor" BIGINT NOT NULL DEFAULT 0,
    "monthly_cap_minor" BIGINT NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMPTZ(3),
    "last_sync_error" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ad_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ad_account_id" UUID NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "daily_budget_minor" BIGINT,
    "start_date" DATE,
    "end_date" DATE,
    "marketing_campaign_id" UUID,
    "plan" TEXT,
    "spend_minor" BIGINT NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue_minor" BIGINT NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ad_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ad_campaign_id" UUID NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "targeting" JSONB NOT NULL DEFAULT '{}',
    "bid_minor" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_ad_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ad_group_id" UUID NOT NULL,
    "external_id" TEXT,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cta" TEXT,
    "url" TEXT,
    "asset_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ad_audiences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ad_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "external_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_ad_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_ad_metrics" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ad_campaign_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "spend_minor" BIGINT NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "conversions" DOUBLE PRECISION NOT NULL,
    "revenue_minor" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "marketing_ad_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_engagements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "target_id" UUID,
    "provider" "MarketingSocialProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "author_name" TEXT,
    "text" TEXT NOT NULL,
    "sentiment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "reply_draft" TEXT,
    "reply_text" TEXT,
    "reply_external_id" TEXT,
    "replied_at" TIMESTAMPTZ(3),
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_influencers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT,
    "profile_url" TEXT,
    "email" TEXT,
    "followers" INTEGER,
    "niche" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROSPECT',
    "notes" TEXT,
    "outreach_subject" TEXT,
    "outreach_draft" TEXT,
    "outreach_status" TEXT,
    "last_contact_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_influencers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_journeys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "strategy_task_id" UUID,
    "campaign_id" UUID,
    "autopilot_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "marketing_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_project_kickoffs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "start_date" DATE,
    "due_date" DATE,
    "step" TEXT NOT NULL DEFAULT 'plan',
    "agent_task_id" UUID,
    "project_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "work_project_kickoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_hiring_journeys_job_id_key" ON "hr_hiring_journeys"("job_id");

-- CreateIndex
CREATE INDEX "hr_hiring_journeys_organization_id_company_id_completed_at_idx" ON "hr_hiring_journeys"("organization_id", "company_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "hr_hiring_journeys_job_id_company_id_key" ON "hr_hiring_journeys"("job_id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_autopilots_status_idx" ON "marketing_autopilots"("status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_autopilots_id_company_id_key" ON "marketing_autopilots"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_autopilot_items_stage_updated_at_idx" ON "marketing_autopilot_items"("stage", "updated_at");

-- CreateIndex
CREATE INDEX "marketing_autopilot_items_company_id_slot_at_idx" ON "marketing_autopilot_items"("company_id", "slot_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_autopilot_items_id_company_id_key" ON "marketing_autopilot_items"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_autopilot_items_autopilot_id_platform_format_slot_key" ON "marketing_autopilot_items"("autopilot_id", "platform", "format", "slot_at");

-- CreateIndex
CREATE INDEX "marketing_assets_company_id_kind_created_at_idx" ON "marketing_assets"("company_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "marketing_assets_status_provider_idx" ON "marketing_assets"("status", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_assets_id_company_id_key" ON "marketing_assets"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_hashtag_sets_company_id_name_key" ON "marketing_hashtag_sets"("company_id", "name");

-- CreateIndex
CREATE INDEX "marketing_learnings_company_id_active_kind_idx" ON "marketing_learnings"("company_id", "active", "kind");

-- CreateIndex
CREATE INDEX "marketing_recommendations_company_id_status_idx" ON "marketing_recommendations"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_recommendations_company_id_dedupe_key_key" ON "marketing_recommendations"("company_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "marketing_cms_publications_content_id_idx" ON "marketing_cms_publications"("content_id");

-- CreateIndex
CREATE INDEX "marketing_cms_publications_status_scheduled_at_idx" ON "marketing_cms_publications"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "seo_topic_clusters_project_id_name_key" ON "seo_topic_clusters"("project_id", "name");

-- CreateIndex
CREATE INDEX "seo_search_metrics_project_id_date_idx" ON "seo_search_metrics"("project_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "seo_search_metrics_project_id_date_page_query_key" ON "seo_search_metrics"("project_id", "date", "page", "query");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_email_variants_email_campaign_id_label_key" ON "marketing_email_variants"("email_campaign_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ad_accounts_id_company_id_key" ON "marketing_ad_accounts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ad_accounts_company_id_provider_external_id_key" ON "marketing_ad_accounts"("company_id", "provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ad_campaigns_id_company_id_key" ON "marketing_ad_campaigns"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ad_campaigns_ad_account_id_external_id_key" ON "marketing_ad_campaigns"("ad_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ad_groups_id_company_id_key" ON "marketing_ad_groups"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_ad_metrics_ad_campaign_id_date_key" ON "marketing_ad_metrics"("ad_campaign_id", "date");

-- CreateIndex
CREATE INDEX "marketing_engagements_company_id_status_idx" ON "marketing_engagements"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_engagements_account_id_external_id_key" ON "marketing_engagements"("account_id", "external_id");

-- CreateIndex
CREATE INDEX "marketing_influencers_company_id_status_idx" ON "marketing_influencers"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_journeys_company_id_key" ON "marketing_journeys"("company_id");

-- CreateIndex
CREATE INDEX "work_project_kickoffs_organization_id_company_id_created_by_idx" ON "work_project_kickoffs"("organization_id", "company_id", "created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_project_kickoffs_id_company_id_key" ON "work_project_kickoffs"("id", "company_id");

-- CreateIndex
CREATE INDEX "marketing_content_company_id_parent_id_idx" ON "marketing_content"("company_id", "parent_id");

-- CreateIndex
CREATE INDEX "marketing_social_post_targets_account_id_content_hash_idx" ON "marketing_social_post_targets"("account_id", "content_hash");

-- AddForeignKey
ALTER TABLE "hr_hiring_journeys" ADD CONSTRAINT "hr_hiring_journeys_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_hiring_journeys" ADD CONSTRAINT "hr_hiring_journeys_job_id_company_id_fkey" FOREIGN KEY ("job_id", "company_id") REFERENCES "hr_jobs"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_autopilots" ADD CONSTRAINT "marketing_autopilots_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_autopilot_items" ADD CONSTRAINT "marketing_autopilot_items_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_autopilot_items" ADD CONSTRAINT "marketing_autopilot_items_autopilot_id_company_id_fkey" FOREIGN KEY ("autopilot_id", "company_id") REFERENCES "marketing_autopilots"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_assets" ADD CONSTRAINT "marketing_assets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_hashtag_sets" ADD CONSTRAINT "marketing_hashtag_sets_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_learnings" ADD CONSTRAINT "marketing_learnings_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_recommendations" ADD CONSTRAINT "marketing_recommendations_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_goals" ADD CONSTRAINT "marketing_goals_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_cms_publications" ADD CONSTRAINT "marketing_cms_publications_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_cms_publications" ADD CONSTRAINT "marketing_cms_publications_content_id_company_id_fkey" FOREIGN KEY ("content_id", "company_id") REFERENCES "marketing_content"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_topic_clusters" ADD CONSTRAINT "seo_topic_clusters_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_search_metrics" ADD CONSTRAINT "seo_search_metrics_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_variants" ADD CONSTRAINT "marketing_email_variants_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_email_variants" ADD CONSTRAINT "marketing_email_variants_email_campaign_id_company_id_fkey" FOREIGN KEY ("email_campaign_id", "company_id") REFERENCES "marketing_email_campaigns"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_accounts" ADD CONSTRAINT "marketing_ad_accounts_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_campaigns" ADD CONSTRAINT "marketing_ad_campaigns_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_campaigns" ADD CONSTRAINT "marketing_ad_campaigns_ad_account_id_company_id_fkey" FOREIGN KEY ("ad_account_id", "company_id") REFERENCES "marketing_ad_accounts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_groups" ADD CONSTRAINT "marketing_ad_groups_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_groups" ADD CONSTRAINT "marketing_ad_groups_ad_campaign_id_company_id_fkey" FOREIGN KEY ("ad_campaign_id", "company_id") REFERENCES "marketing_ad_campaigns"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ads" ADD CONSTRAINT "marketing_ads_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ads" ADD CONSTRAINT "marketing_ads_ad_group_id_company_id_fkey" FOREIGN KEY ("ad_group_id", "company_id") REFERENCES "marketing_ad_groups"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ads" ADD CONSTRAINT "marketing_ads_asset_id_company_id_fkey" FOREIGN KEY ("asset_id", "company_id") REFERENCES "marketing_assets"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "marketing_ad_audiences" ADD CONSTRAINT "marketing_ad_audiences_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_audiences" ADD CONSTRAINT "marketing_ad_audiences_ad_account_id_company_id_fkey" FOREIGN KEY ("ad_account_id", "company_id") REFERENCES "marketing_ad_accounts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_metrics" ADD CONSTRAINT "marketing_ad_metrics_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_ad_metrics" ADD CONSTRAINT "marketing_ad_metrics_ad_campaign_id_company_id_fkey" FOREIGN KEY ("ad_campaign_id", "company_id") REFERENCES "marketing_ad_campaigns"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_engagements" ADD CONSTRAINT "marketing_engagements_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_influencers" ADD CONSTRAINT "marketing_influencers_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_journeys" ADD CONSTRAINT "marketing_journeys_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_parent_id_company_id_fkey" FOREIGN KEY ("parent_id", "company_id") REFERENCES "marketing_content"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "marketing_content" ADD CONSTRAINT "marketing_content_featured_asset_id_company_id_fkey" FOREIGN KEY ("featured_asset_id", "company_id") REFERENCES "marketing_assets"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "marketing_social_posts" ADD CONSTRAINT "marketing_social_posts_media_asset_id_company_id_fkey" FOREIGN KEY ("media_asset_id", "company_id") REFERENCES "marketing_assets"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "work_project_kickoffs" ADD CONSTRAINT "work_project_kickoffs_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
