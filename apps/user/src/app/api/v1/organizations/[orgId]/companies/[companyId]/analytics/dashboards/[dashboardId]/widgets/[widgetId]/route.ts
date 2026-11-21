import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteWidget, updateWidget, widgetUpdateInput } from "@/server/modules/bi/dashboards";

type P = { orgId: string; companyId: string; dashboardId: string; widgetId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/analytics/dashboards/:id/widgets/:widgetId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, dashboardId, widgetId }) => updateWidget(ctx, orgId, companyId, dashboardId, widgetId, await body(req, widgetUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/analytics/dashboards/:id/widgets/:widgetId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, dashboardId, widgetId }) => deleteWidget(ctx, orgId, companyId, dashboardId, widgetId),
);
