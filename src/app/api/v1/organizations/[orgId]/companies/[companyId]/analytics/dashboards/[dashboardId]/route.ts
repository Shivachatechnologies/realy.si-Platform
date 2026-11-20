import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { dashboardUpdateInput, deleteDashboard, getDashboard, updateDashboard } from "@/server/modules/bi/dashboards";

type P = { orgId: string; companyId: string; dashboardId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, dashboardId }) => getDashboard(ctx, orgId, companyId, dashboardId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/analytics/dashboards/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, dashboardId }) => updateDashboard(ctx, orgId, companyId, dashboardId, await body(req, dashboardUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/analytics/dashboards/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, dashboardId }) => deleteDashboard(ctx, orgId, companyId, dashboardId),
);
