import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteReport, reportUpdateInput, updateReport } from "@/server/modules/bi/dashboards";
import { runReport } from "@/server/modules/bi/report-run";

type P = { orgId: string; companyId: string; reportId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, reportId }) => runReport(ctx, orgId, companyId, reportId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/analytics/reports/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, reportId }) => updateReport(ctx, orgId, companyId, reportId, await body(req, reportUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/analytics/reports/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, reportId }) => deleteReport(ctx, orgId, companyId, reportId),
);
