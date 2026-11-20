import type { MetricDefinition, MetricRange, MetricScope } from "@/server/core/metrics";
import { db } from "@/server/core/db";
import { dealWeighted } from "./deals";

/**
 * KPIs of the crm module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings.
 * Money in minor units of scope.currency (deals in other currencies are excluded); percent values are 0–100.
 */

const base = (s: MetricScope) => ({ organizationId: s.organizationId, companyId: s.companyId });
const DAY = 86_400_000;

async function closedIn(s: MetricScope, r: MetricRange) {
  return db().crmDeal.findMany({
    where: { ...base(s), archivedAt: null, status: { in: ["WON", "LOST"] }, closedAt: { gte: r.from, lt: r.to } },
    select: { status: true, amountMinor: true, currency: true, createdAt: true, closedAt: true },
    take: 50_000,
  });
}

async function openAt(s: MetricScope, r: MetricRange) {
  // Open at range end: created before `to` and not closed before `to`.
  return db().crmDeal.findMany({
    where: { ...base(s), archivedAt: null, currency: s.currency, createdAt: { lt: r.to }, OR: [{ status: "OPEN" }, { closedAt: { gte: r.to } }] },
    select: { amountMinor: true, probability: true, status: true, stage: { select: { probability: true } } },
    take: 50_000,
  });
}

export const CRM_METRICS: MetricDefinition[] = [
  {
    key: "crm.new_leads",
    labelKey: "crm.metrics.newLeads",
    department: "sales",
    unit: "count",
    permission: "sales.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/crm",
    compute: (s, r) => db().lead.count({ where: { ...base(s), mergedIntoId: null, createdAt: { gte: r.from, lt: r.to } } }),
  },
  {
    key: "crm.open_pipeline",
    labelKey: "crm.metrics.openPipeline",
    department: "sales",
    unit: "money",
    permission: "sales.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/crm/pipeline",
    async compute(s, r) {
      return (await openAt(s, r)).reduce((a, d) => a + d.amountMinor, 0n);
    },
  },
  {
    key: "crm.weighted_pipeline",
    labelKey: "crm.metrics.weightedPipeline",
    department: "sales",
    unit: "money",
    permission: "sales.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/crm/pipeline",
    async compute(s, r) {
      // Deals closed after range end were open at range end: weight them by their stage/explicit probability.
      return (await openAt(s, r)).reduce((a, d) => a + dealWeighted({ ...d, status: "OPEN" }), 0n);
    },
  },
  {
    key: "crm.won_revenue",
    labelKey: "crm.metrics.wonRevenue",
    department: "sales",
    unit: "money",
    permission: "sales.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/sales",
    async compute(s, r) {
      return (await closedIn(s, r)).filter((d) => d.status === "WON" && d.currency === s.currency).reduce((a, d) => a + d.amountMinor, 0n);
    },
  },
  {
    key: "crm.win_rate",
    labelKey: "crm.metrics.winRate",
    department: "sales",
    unit: "percent",
    permission: "sales.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/sales/reports",
    async compute(s, r) {
      const d = await closedIn(s, r);
      const won = d.filter((x) => x.status === "WON").length;
      return d.length ? Math.round((won / d.length) * 1000) / 10 : 0;
    },
  },
  {
    key: "crm.avg_deal_size",
    labelKey: "crm.metrics.avgDealSize",
    department: "sales",
    unit: "money",
    permission: "sales.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/sales/reports",
    async compute(s, r) {
      const won = (await closedIn(s, r)).filter((d) => d.status === "WON" && d.currency === s.currency);
      return won.length ? won.reduce((a, d) => a + d.amountMinor, 0n) / BigInt(won.length) : 0n;
    },
  },
  {
    key: "crm.sales_cycle_days",
    labelKey: "crm.metrics.salesCycle",
    department: "sales",
    unit: "days",
    permission: "sales.read",
    kind: "flow",
    higherIsBetter: false,
    href: "/sales/reports",
    async compute(s, r) {
      const won = (await closedIn(s, r)).filter((d) => d.status === "WON");
      return won.length ? Math.round((won.reduce((a, d) => a + (d.closedAt!.getTime() - d.createdAt.getTime()), 0) / won.length / DAY) * 10) / 10 : 0;
    },
  },
  {
    key: "crm.conversion_rate",
    labelKey: "crm.metrics.conversionRate",
    department: "sales",
    unit: "percent",
    permission: "sales.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/sales/reports",
    async compute(s, r) {
      const where = { ...base(s), mergedIntoId: null, createdAt: { gte: r.from, lt: r.to } };
      const [total, converted] = await Promise.all([db().lead.count({ where }), db().lead.count({ where: { ...where, convertedAt: { not: null } } })]);
      return total ? Math.round((converted / total) * 1000) / 10 : 0;
    },
  },
];
