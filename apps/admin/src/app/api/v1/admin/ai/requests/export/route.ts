import { route } from "@/server/core/http";
import { exportAiRequestsCsv } from "@/server/modules/admin/ai-requests";

/** CSV of the filtered AI request log (max 10 000 rows, no sensitive columns, audited). */
export const GET = route({ auth: "required", name: "GET /admin/ai/requests/export" }, async ({ req, ctx }) => {
  const f = await exportAiRequestsCsv(ctx, Object.fromEntries(req.nextUrl.searchParams));
  return new Response(f.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "no-store" } });
});
