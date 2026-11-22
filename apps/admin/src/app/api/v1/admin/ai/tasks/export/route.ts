import { route } from "@/server/core/http";
import { exportTasksCsv } from "@/server/modules/admin/ai-tasks";

/** CSV of the AI task list for the current filters (metadata only, max 5 000 rows, audited). */
export const GET = route({ auth: "required", name: "GET /admin/ai/tasks/export" }, async ({ req, ctx }) => {
  const f = await exportTasksCsv(ctx, Object.fromEntries(req.nextUrl.searchParams));
  return new Response(f.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "no-store" } });
});
