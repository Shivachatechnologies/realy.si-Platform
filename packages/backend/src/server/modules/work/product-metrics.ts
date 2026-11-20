import type { MetricDefinition } from "@/server/core/metrics";
import { db } from "@/server/core/db";

const DAY = 86_400_000;

/** Product KPIs (spread into WORK_METRICS). */
export const PRODUCT_METRICS: MetricDefinition[] = [
  {
    key: "work.active_products",
    labelKey: "product.metrics.activeProducts",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/product",
    compute: ({ organizationId, companyId }, { to }) =>
      db().product.count({ where: { organizationId, companyId, status: "ACTIVE", createdAt: { lt: to }, OR: [{ archivedAt: null }, { archivedAt: { gte: to } }] } }),
  },
  {
    key: "work.features_shipped",
    labelKey: "product.metrics.featuresShipped",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/product/features?status=SHIPPED",
    // Shipped with a release dated in the range, or (without a release date) marked shipped in the range.
    compute: ({ organizationId, companyId }, { from, to }) =>
      db().productFeature.count({
        where: {
          organizationId,
          companyId,
          archivedAt: null,
          status: "SHIPPED",
          OR: [{ release: { releaseDate: { gte: from, lt: to } } }, { release: { releaseDate: null }, updatedAt: { gte: from, lt: to } }, { releaseId: null, updatedAt: { gte: from, lt: to } }],
        },
      }),
  },
  {
    key: "work.product_releases",
    labelKey: "product.metrics.productReleases",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/product/releases",
    compute: ({ organizationId, companyId }, { from, to }) => db().productRelease.count({ where: { organizationId, companyId, status: "RELEASED", releaseDate: { gte: from, lt: to } } }),
  },
  {
    key: "work.product_feedback",
    labelKey: "product.metrics.productFeedback",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "flow",
    href: "/product/feedback",
    compute: ({ organizationId, companyId }, { from, to }) => db().productFeedback.count({ where: { organizationId, companyId, createdAt: { gte: from, lt: to } } }),
  },
  {
    key: "work.negative_feedback_share",
    labelKey: "product.metrics.negativeFeedbackShare",
    department: "projects",
    unit: "percent",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: false,
    // Share of rated feedback in the range that is negative.
    compute: async ({ organizationId, companyId }, { from, to }) => {
      const rows = await db().productFeedback.groupBy({ by: ["sentiment"], where: { organizationId, companyId, createdAt: { gte: from, lt: to }, sentiment: { not: null } }, _count: { _all: true } });
      const total = rows.reduce((s, r) => s + r._count._all, 0);
      const neg = rows.find((r) => r.sentiment === "NEGATIVE")?._count._all ?? 0;
      return total ? Math.round((neg / total) * 1000) / 10 : 0;
    },
  },
  {
    key: "work.stage_cycle_time",
    labelKey: "product.metrics.stageCycleTime",
    department: "projects",
    unit: "days",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: false,
    // Average days a product spent in a lifecycle stage, over stages exited in the range.
    compute: async ({ organizationId, companyId }, { from, to }) => {
      const rows = await db().productStageChange.findMany({ where: { organizationId, companyId, exitedAt: { gte: from, lt: to } }, select: { enteredAt: true, exitedAt: true }, take: 20_000 });
      if (!rows.length) return 0;
      return Math.round((rows.reduce((s, r) => s + (r.exitedAt!.getTime() - r.enteredAt.getTime()), 0) / rows.length / DAY) * 10) / 10;
    },
  },
  {
    key: "work.stage_gates_approved",
    labelKey: "product.metrics.stageGatesApproved",
    department: "projects",
    unit: "count",
    permission: "projects.read",
    kind: "flow",
    higherIsBetter: true,
    compute: ({ organizationId, companyId }, { from, to }) => db().productStageGate.count({ where: { organizationId, companyId, approvedAt: { gte: from, lt: to } } }),
  },
];
