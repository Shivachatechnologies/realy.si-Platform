import { db } from "@/server/core/db";
import type { MetricDefinition } from "@/server/core/metrics";

const TEMPLATE_TYPES = ["COMPANY_TEMPLATE", "DEPARTMENT_TEMPLATE", "INDUSTRY_BLUEPRINT"] as const;

/** KPIs of the marketplace module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. */
export const MARKETPLACE_METRICS: MetricDefinition[] = [
  {
    key: "marketplace.installed_templates",
    labelKey: "marketplace.metrics.installedTemplates",
    department: "operations",
    unit: "count",
    permission: "marketplace.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/marketplace/installed",
    compute: ({ organizationId, companyId }, { to }) =>
      db().marketplaceInstallation.count({
        where: {
          organizationId,
          companyId,
          listingType: { in: [...TEMPLATE_TYPES] },
          installedAt: { lt: to },
          OR: [{ uninstalledAt: null }, { uninstalledAt: { gte: to } }],
        },
      }),
  },
  {
    key: "marketplace.installs",
    labelKey: "marketplace.metrics.installs",
    department: "operations",
    unit: "count",
    permission: "marketplace.read",
    kind: "flow",
    higherIsBetter: true,
    href: "/marketplace/installed",
    compute: ({ organizationId, companyId }, { from, to }) =>
      db().marketplaceInstallation.count({
        where: {
          organizationId,
          companyId,
          installedAt: { gte: from, lt: to },
        },
      }),
  },
];
