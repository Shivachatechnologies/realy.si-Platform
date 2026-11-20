import { route } from "@/server/core/http";
import { csvResponse } from "@/server/modules/hr/csv";
import { exportRunCsv } from "@/server/modules/hr/payroll";

type P = { orgId: string; companyId: string; id: string };

/** CSV of a payroll run's payslips (payroll.read). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => {
  const { csv, filename } = await exportRunCsv(ctx, orgId, companyId, id);
  return csvResponse(filename, csv);
});
