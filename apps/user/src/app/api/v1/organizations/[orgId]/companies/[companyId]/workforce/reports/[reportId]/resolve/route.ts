import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { resolveReport, resolveReportInput } from "@/server/modules/workforce/hierarchy";

type P = { orgId: string; companyId: string; reportId: string };

/** Close an escalation. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/reports/:id/resolve", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, reportId }) => resolveReport(ctx, orgId, companyId, reportId, await body(req, resolveReportInput)),
);
