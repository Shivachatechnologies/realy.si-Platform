import { db } from "@/server/core/db";
import type { MetricDefinition } from "@/server/core/metrics";
import { API_KEY_ROLE_PREFIX } from "./roles";

/** KPIs of the enterprise module (see src/server/core/metrics.ts); used by analytics, dashboards and AI briefings. Organization-wide values. */
export const ENTERPRISE_METRICS: MetricDefinition[] = [
  {
    key: "enterprise.active_members",
    labelKey: "enterprise.metrics.activeMembers",
    department: "executive",
    unit: "count",
    permission: "users.read",
    kind: "stock",
    higherIsBetter: true,
    href: "/settings/members",
    compute: ({ organizationId }, { to }) =>
      db().membership.count({
        where: { organizationId, status: "ACTIVE", createdAt: { lt: to } },
      }),
  },
  {
    key: "enterprise.api_keys_active",
    labelKey: "enterprise.metrics.apiKeysActive",
    department: "operations",
    unit: "count",
    permission: "developer.read",
    kind: "stock",
    href: "/settings/developers",
    compute: ({ organizationId }, { to }) =>
      db().apiKey.count({
        where: {
          organizationId,
          createdAt: { lt: to },
          OR: [{ revokedAt: null }, { revokedAt: { gte: to } }],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: to } }] }],
        },
      }),
  },
  {
    key: "enterprise.custom_roles",
    labelKey: "enterprise.metrics.customRoles",
    department: "operations",
    unit: "count",
    permission: "roles.read",
    kind: "stock",
    href: "/settings/roles",
    compute: ({ organizationId }, { to }) =>
      db().role.count({
        where: {
          organizationId,
          isSystem: false,
          createdAt: { lt: to },
          NOT: { key: { startsWith: API_KEY_ROLE_PREFIX } },
        },
      }),
  },
];
