import { route } from "@/server/core/http";
import { exportSettings } from "@/server/modules/admin/controls";

/** JSON of every platform control value (never secrets). */
export const GET = route({ auth: "required", name: "GET /admin/controls/export" }, async ({ ctx }) => {
  const json = await exportSettings(ctx);
  return new Response(json, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="realy-settings-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } });
});
