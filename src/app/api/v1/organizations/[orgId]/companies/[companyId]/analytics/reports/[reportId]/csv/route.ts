import { route } from "@/server/core/http";
import { reportCsv, runReport } from "@/server/modules/bi/report-run";

type P = { orgId: string; companyId: string; reportId: string };

/** CSV export of a saved report (UTF-8 with BOM so spreadsheets detect the encoding). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, reportId }) => {
  const r = await runReport(ctx, orgId, companyId, reportId);
  const name = r.report.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "report";
  return new Response(`\uFEFF${reportCsv(r)}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });
});
