import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

/** KPIs of the integrations module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const INTEGRATIONS_METRICS: MetricDefinition[] = [
  {
    key: "integrations.connected",
    labelKey: "integrations.metrics.connected",
    department: "operations",
    unit: "count",
    permission: "integrations.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/integrations",
    compute: ({ organizationId, companyId }, { to }) =>
      db().integrationConnection.count({ where: { organizationId, companyId, status: { in: ["CONNECTED", "ERROR"] }, connectedAt: { lt: to } } }),
  },
  {
    key: "integrations.sync_errors",
    labelKey: "integrations.metrics.syncErrors",
    department: "operations",
    unit: "count",
    permission: "integrations.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/integrations/syncs",
    compute: ({ organizationId, companyId }, { from, to }) =>
      db().integrationSyncRun.count({ where: { organizationId, companyId, status: { in: ["FAILED", "PARTIAL"] }, startedAt: { gte: from, lt: to } } }),
  },
  {
    key: "integrations.webhook_failures",
    labelKey: "integrations.metrics.webhookFailures",
    department: "operations",
    unit: "count",
    permission: "integrations.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/integrations/webhooks",
    compute: ({ organizationId, companyId }, { from, to }) =>
      db().integrationWebhookDelivery.count({ where: { organizationId, companyId, status: "FAILED", updatedAt: { gte: from, lt: to } } }),
  },
];
