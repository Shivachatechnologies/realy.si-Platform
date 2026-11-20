import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

/** KPIs of the comms module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const COMMS_METRICS: MetricDefinition[] = [
  {
    key: "comms.announcements_published",
    labelKey: "communication.metrics.announcementsPublished",
    department: "executive",
    unit: "count",
    permission: "communication.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/communication/announcements",
    compute: ({ organizationId, companyId }, { from, to }) => db().commsAnnouncement.count({ where: { organizationId, companyId, status: "PUBLISHED", publishedAt: { gte: from, lt: to } } }),
  },
  {
    key: "comms.meetings_held",
    labelKey: "communication.metrics.meetingsHeld",
    department: "executive",
    unit: "count",
    permission: "communication.read",
    kind: "flow",
    href: "/communication/meetings",
    compute: ({ organizationId, companyId }, { from, to }) => db().commsMeeting.count({ where: { organizationId, companyId, status: "COMPLETED", startsAt: { gte: from, lt: to } } }),
  },
  {
    key: "comms.open_action_items",
    labelKey: "communication.metrics.openActionItems",
    department: "executive",
    unit: "count",
    permission: "communication.read",
    kind: "stock",
    higherIsBetter: false,
    href: "/communication/meetings",
    compute: ({ organizationId, companyId }, { to }) =>
      db().workTask.count({
        where: { organizationId, companyId, sourceType: "meeting", createdAt: { lt: to }, OR: [{ status: { notIn: ["DONE", "CANCELLED"] } }, { completedAt: { gte: to } }] },
      }),
  },
];
