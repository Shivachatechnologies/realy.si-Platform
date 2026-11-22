-- CreateEnum
CREATE TYPE "ServiceHealthStatus" AS ENUM ('OPERATIONAL', 'HEALTHY', 'DEGRADED', 'CRITICAL', 'DOWN', 'MAINTENANCE', 'UNKNOWN', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "PlatformIncidentSeverity" AS ENUM ('SEV1', 'SEV2', 'SEV3', 'SEV4');

-- CreateEnum
CREATE TYPE "PlatformIncidentStatus" AS ENUM ('DETECTED', 'INVESTIGATING', 'IDENTIFIED', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlatformAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PlatformAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ErrorGroupStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED', 'REGRESSED');

-- CreateTable
CREATE TABLE "service_health_checks" (
    "id" UUID NOT NULL,
    "service" TEXT NOT NULL,
    "status" "ServiceHealthStatus" NOT NULL,
    "latency_ms" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_incidents" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "PlatformIncidentSeverity" NOT NULL,
    "status" "PlatformIncidentStatus" NOT NULL DEFAULT 'DETECTED',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affected_organization_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "customer_impact" TEXT,
    "summary" TEXT,
    "owner_id" UUID,
    "root_cause" TEXT,
    "mitigation" TEXT,
    "resolution" TEXT,
    "postmortem" TEXT,
    "postmortem_state" TEXT NOT NULL DEFAULT 'none',
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "identified_at" TIMESTAMPTZ(3),
    "mitigated_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_incident_updates" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "PlatformIncidentStatus",
    "message" TEXT NOT NULL,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alerts" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "group_key" TEXT NOT NULL,
    "service" TEXT,
    "severity" "PlatformAlertSeverity" NOT NULL,
    "status" "PlatformAlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "organization_id" UUID,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignee_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" UUID,
    "snoozed_until" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" TEXT,
    "escalation_level" INTEGER NOT NULL DEFAULT 0,
    "escalated_at" TIMESTAMPTZ(3),
    "last_notified_at" TIMESTAMPTZ(3),
    "incident_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alert_events" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_groups" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "route" TEXT,
    "status" "ErrorGroupStatus" NOT NULL DEFAULT 'OPEN',
    "count" INTEGER NOT NULL DEFAULT 0,
    "assignee_id" UUID,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "incident_id" UUID,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_release" TEXT,
    "last_release" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "request_id" TEXT,
    "organization_id" UUID,
    "release" TEXT,
    "route" TEXT,
    "method" TEXT,
    "status_code" INTEGER,
    "stack" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_releases" (
    "id" UUID NOT NULL,
    "app" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "ref" TEXT,
    "message" TEXT,
    "environment" TEXT NOT NULL,
    "deployment_id" TEXT,
    "url" TEXT,
    "deployed_at" TIMESTAMPTZ(3),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boots" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "platform_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_log_entries" (
    "id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "request_id" TEXT,
    "organization_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_health_checks_service_checked_at_idx" ON "service_health_checks"("service", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "service_health_checks_checked_at_idx" ON "service_health_checks"("checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_incidents_number_key" ON "platform_incidents"("number");

-- CreateIndex
CREATE INDEX "platform_incidents_status_detected_at_idx" ON "platform_incidents"("status", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "platform_incidents_severity_detected_at_idx" ON "platform_incidents"("severity", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "platform_incidents_owner_id_idx" ON "platform_incidents"("owner_id");

-- CreateIndex
CREATE INDEX "platform_incident_updates_incident_id_created_at_idx" ON "platform_incident_updates"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_alerts_fingerprint_status_idx" ON "platform_alerts"("fingerprint", "status");

-- CreateIndex
CREATE INDEX "platform_alerts_status_severity_last_seen_at_idx" ON "platform_alerts"("status", "severity", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "platform_alerts_group_key_last_seen_at_idx" ON "platform_alerts"("group_key", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "platform_alerts_incident_id_idx" ON "platform_alerts"("incident_id");

-- CreateIndex
CREATE INDEX "platform_alert_events_alert_id_created_at_idx" ON "platform_alert_events"("alert_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "error_groups_fingerprint_key" ON "error_groups"("fingerprint");

-- CreateIndex
CREATE INDEX "error_groups_status_last_seen_at_idx" ON "error_groups"("status", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "error_groups_last_seen_at_idx" ON "error_groups"("last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "error_events_group_id_created_at_idx" ON "error_events"("group_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "error_events_created_at_idx" ON "error_events"("created_at");

-- CreateIndex
CREATE INDEX "error_events_request_id_idx" ON "error_events"("request_id");

-- CreateIndex
CREATE INDEX "platform_releases_app_first_seen_at_idx" ON "platform_releases"("app", "first_seen_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "platform_releases_app_sha_environment_key" ON "platform_releases"("app", "sha", "environment");

-- CreateIndex
CREATE INDEX "app_log_entries_created_at_idx" ON "app_log_entries"("created_at" DESC);

-- CreateIndex
CREATE INDEX "app_log_entries_level_created_at_idx" ON "app_log_entries"("level", "created_at" DESC);

-- CreateIndex
CREATE INDEX "app_log_entries_request_id_idx" ON "app_log_entries"("request_id");

-- AddForeignKey
ALTER TABLE "platform_incident_updates" ADD CONSTRAINT "platform_incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "platform_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_alert_events" ADD CONSTRAINT "platform_alert_events_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "platform_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

