import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reorderInput, reorderWidgets } from "@/server/modules/bi/dashboards";

type P = { orgId: string; companyId: string; dashboardId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/analytics/dashboards/:id/widgets/reorder", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, dashboardId }) => reorderWidgets(ctx, orgId, companyId, dashboardId, await body(req, reorderInput)),
);
