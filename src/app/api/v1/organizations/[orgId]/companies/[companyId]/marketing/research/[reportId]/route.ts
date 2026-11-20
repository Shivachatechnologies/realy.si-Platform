import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { archiveResearchReport, getResearchReport } from "@/server/modules/marketing/research-reports";

type P = { orgId: string; companyId: string; reportId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, reportId }) => getResearchReport(ctx, orgId, companyId, reportId));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/research/:reportId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, reportId }) => archiveResearchReport(ctx, orgId, companyId, reportId));
