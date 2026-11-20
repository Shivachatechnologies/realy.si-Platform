import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addWidget, widgetInput } from "@/server/modules/bi/dashboards";

type P = { orgId: string; companyId: string; dashboardId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/analytics/dashboards/:id/widgets", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, dashboardId }) => addWidget(ctx, orgId, companyId, dashboardId, await body(req, widgetInput)),
);
