import type { MetricDefinition, MetricRange, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";
import { attribution, computeKpis } from "./analytics";

const kpis = (s: MetricScope, r: MetricRange) => computeKpis(s.organizationId, s.companyId, r);
const base = { department: "marketing", permission: "marketing.read" } as const;

/** KPIs of the marketing module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const MARKETING_METRICS: MetricDefinition[] = [
  { ...base, key: "marketing.spend", labelKey: "marketing.metrics.spend", unit: "money", kind: "flow", higherIsBetter: false, href: "/marketing", compute: async (s, r) => (await kpis(s, r)).spendMinor },
  { ...base, key: "marketing.leads_generated", labelKey: "marketing.metrics.leadsGenerated", unit: "count", kind: "flow", higherIsBetter: true, href: "/marketing", compute: async (s, r) => (await kpis(s, r)).leadsCreated },
  { ...base, key: "marketing.cac", labelKey: "marketing.metrics.cac", unit: "money", kind: "flow", higherIsBetter: false, href: "/marketing", compute: async (s, r) => (await kpis(s, r)).cacMinor ?? 0n },
  {
    ...base,
    key: "marketing.campaign_roi",
    labelKey: "marketing.metrics.campaignRoi",
    unit: "percent",
    kind: "flow",
    higherIsBetter: true,
    href: "/marketing/campaigns",
    compute: async (s, r) => {
      // ROI over spend attributed to campaigns (revenue of won leads carrying a campaign code).
      const rows = await attribution(s.organizationId, s.companyId, r);
      const spend = rows.reduce((n, c) => n + c.spendMinor, 0n);
      const revenue = rows.reduce((n, c) => n + c.revenueMinor, 0n);
      return spend > 0n ? Math.round((Number(revenue - spend) / Number(spend)) * 1000) / 10 : 0;
    },
  },
  { ...base, key: "marketing.emails_sent", labelKey: "marketing.metrics.emailsSent", unit: "count", kind: "flow", higherIsBetter: true, href: "/marketing/email", compute: async (s, r) => (await kpis(s, r)).emailsSent },
  { ...base, key: "marketing.posts_published", labelKey: "marketing.metrics.postsPublished", unit: "count", kind: "flow", higherIsBetter: true, href: "/marketing/social", compute: async (s, r) => (await kpis(s, r)).postsPublished },
  { ...base, key: "marketing.conversion_rate", labelKey: "marketing.metrics.conversionRate", unit: "percent", kind: "flow", higherIsBetter: true, href: "/marketing", compute: async (s, r) => Math.round(((await kpis(s, r)).conversionRate ?? 0) * 10) / 10 },
  {
    ...base,
    key: "marketing.active_campaigns",
    labelKey: "marketing.metrics.activeCampaigns",
    unit: "count",
    kind: "stock",
    higherIsBetter: true,
    href: "/marketing/campaigns",
    compute: (s) => db().marketingCampaign.count({ where: { organizationId: s.organizationId, companyId: s.companyId, status: "ACTIVE", archivedAt: null } }),
  },
];
