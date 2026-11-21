import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createReport, listReports, reportInput } from "@/server/modules/bi/dashboards";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listReports(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/analytics/reports", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createReport(ctx, orgId, companyId, await body(req, reportInput)),
);
