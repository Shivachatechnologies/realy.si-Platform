import { route } from "@/server/core/http";
import { exportAuditCsv, exportAuditJson } from "@/server/modules/admin/security";

/** CSV (default) or JSON (`?format=json`) of the filtered platform audit trail (same filters as the audit page). */
export const GET = route({ auth: "required", name: "GET /admin/audit-logs/export" }, async ({ req, ctx }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const json = params.format === "json";
  const day = new Date().toISOString().slice(0, 10);
  const content = json ? await exportAuditJson(ctx, params) : await exportAuditCsv(ctx, params);
  return new Response(content, {
    headers: {
      "content-type": json ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="realy-audit-${day}.${json ? "json" : "csv"}"`,
      "cache-control": "no-store",
    },
  });
});
