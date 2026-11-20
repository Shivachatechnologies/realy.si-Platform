-- Super Admin platform controls (kill switches, settings) and worker heartbeats. Additive only.
BEGIN;


-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_heartbeats" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "info" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "platform_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_heartbeats_kind_last_seen_at_idx" ON "platform_heartbeats"("kind", "last_seen_at" DESC);

COMMIT;
