import { route } from "@/server/core/http";
import { exportAuditCsv } from "@/server/modules/admin/security";

/** CSV of the filtered platform audit trail (same filters as the Security & Audit page). */
export const GET = route({ auth: "required", name: "GET /admin/audit-logs/export" }, async ({ req, ctx }) => {
  const csv = await exportAuditCsv(ctx, Object.fromEntries(req.nextUrl.searchParams));
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="realy-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
});
