import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { rerunResearchReport } from "@/server/modules/marketing/research-reports";

type P = { orgId: string; companyId: string; reportId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/research/:reportId/rerun", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, reportId }) => rerunResearchReport(ctx, orgId, companyId, reportId));
