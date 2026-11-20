import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

/** KPIs of the website live chat (src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const LIVECHAT_METRICS: MetricDefinition[] = [
  {
    key: "livechat.conversations",
    labelKey: "livechat.metrics.conversations",
    department: "support",
    unit: "count",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/livechat?status=all",
    compute: ({ organizationId, companyId }, { from, to }) => db().livechatConversation.count({ where: { organizationId, companyId, createdAt: { gte: from, lt: to } } }),
  },
  {
    key: "livechat.ai_resolution_rate",
    labelKey: "livechat.metrics.aiResolutionRate",
    department: "support",
    unit: "percent",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/livechat",
    async compute({ organizationId, companyId }, { from, to }) {
      const where = { organizationId, companyId, closedAt: { gte: from, lt: to } };
      const [closed, resolved] = await Promise.all([db().livechatConversation.count({ where }), db().livechatConversation.count({ where: { ...where, aiResolved: true } })]);
      return closed ? Math.round((resolved / closed) * 1000) / 10 : 0;
    },
  },
  {
    key: "livechat.leads_captured",
    labelKey: "livechat.metrics.leadsCaptured",
    department: "sales",
    unit: "count",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/livechat?status=all",
    compute: ({ organizationId, companyId }, { from, to }) => db().livechatConversation.count({ where: { organizationId, companyId, createdAt: { gte: from, lt: to }, leadId: { not: null } } }),
  },
  {
    key: "livechat.handoffs",
    labelKey: "livechat.metrics.handoffs",
    department: "support",
    unit: "count",
    permission: "support.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/livechat?status=waiting",
    compute: ({ organizationId, companyId }, { from, to }) => db().livechatConversation.count({ where: { organizationId, companyId, handoffAt: { gte: from, lt: to } } }),
  },
];
