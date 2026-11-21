import { route } from "@/server/core/http";
import { crmDashboard } from "@/server/modules/crm/service";

export const GET = route<{ orgId: string; companyId: string }>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => crmDashboard(ctx, orgId, companyId));
