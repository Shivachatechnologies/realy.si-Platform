import { route } from "@/server/core/http";
import { getPayslip } from "@/server/modules/hr/payroll";

type P = { orgId: string; companyId: string; id: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => getPayslip(ctx, orgId, companyId, id));
