import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createDashboard, dashboardInput, listDashboards } from "@/server/modules/bi/dashboards";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listDashboards(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/analytics/dashboards", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createDashboard(ctx, orgId, companyId, await body(req, dashboardInput)),
);
