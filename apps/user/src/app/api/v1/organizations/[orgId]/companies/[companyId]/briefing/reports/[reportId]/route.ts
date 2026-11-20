import { route } from "@/server/core/http";
import { getReport } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string; reportId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, reportId }) => getReport(ctx, orgId, companyId, reportId));
