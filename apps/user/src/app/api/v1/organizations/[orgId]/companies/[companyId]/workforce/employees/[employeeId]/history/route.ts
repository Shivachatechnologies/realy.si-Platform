import { route } from "@/server/core/http";
import { workHistory } from "@/server/modules/workforce/lifecycle";

type P = { orgId: string; companyId: string; employeeId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, employeeId }) => ({ data: await workHistory(ctx, orgId, companyId, employeeId) }));
