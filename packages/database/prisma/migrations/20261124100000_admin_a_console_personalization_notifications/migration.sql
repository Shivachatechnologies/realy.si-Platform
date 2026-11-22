-- CreateEnum
CREATE TYPE "PlatformNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "admin_preferences" (
    "user_id" UUID NOT NULL,
    "favorites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recents" JSONB NOT NULL DEFAULT '[]',
    "recent_searches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sidebar" JSONB NOT NULL DEFAULT '{}',
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "time_range" TEXT NOT NULL DEFAULT '30d',
    "notification_prefs" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "admin_saved_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "page" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL DEFAULT '{}',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "permission" TEXT,
    "type" TEXT NOT NULL,
    "severity" "PlatformNotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "dedupe_key" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_raised_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notification_reads" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notification_reads_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateIndex
CREATE INDEX "admin_saved_views_user_id_page_idx" ON "admin_saved_views"("user_id", "page");

-- CreateIndex
CREATE INDEX "admin_saved_views_page_shared_idx" ON "admin_saved_views"("page", "shared");

-- CreateIndex
CREATE UNIQUE INDEX "platform_notifications_dedupe_key_key" ON "platform_notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "platform_notifications_user_id_last_raised_at_idx" ON "platform_notifications"("user_id", "last_raised_at" DESC);

-- CreateIndex
CREATE INDEX "platform_notifications_permission_last_raised_at_idx" ON "platform_notifications"("permission", "last_raised_at" DESC);

-- CreateIndex
CREATE INDEX "platform_notifications_last_raised_at_idx" ON "platform_notifications"("last_raised_at");

-- CreateIndex
CREATE INDEX "admin_notification_reads_user_id_read_at_idx" ON "admin_notification_reads"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "admin_notification_reads" ADD CONSTRAINT "admin_notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "platform_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

