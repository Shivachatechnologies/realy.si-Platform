import { route } from "@/server/core/http";
import { csvResponse } from "@/server/modules/hr/csv";
import { exportEmployeesCsv, parseEmployeeFilters } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string };

/** CSV of the directory (same filters as the list). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  csvResponse(`employees-${new Date().toISOString().slice(0, 10)}.csv`, await exportEmployeesCsv(ctx, orgId, companyId, parseEmployeeFilters(Object.fromEntries(req.nextUrl.searchParams)))),
);
