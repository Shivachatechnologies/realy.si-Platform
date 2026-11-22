import { route } from "@/server/core/http";
import { exportTaskLog } from "@/server/modules/admin/ai-tasks";

/** Download one task's execution log as JSON (audited). */
export const GET = route<{ taskId: string }>({ auth: "required", name: "GET /admin/ai/tasks/:id/export" }, async ({ ctx }, { taskId }) => {
  const f = await exportTaskLog(ctx, taskId);
  return new Response(f.json, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "no-store" } });
});
