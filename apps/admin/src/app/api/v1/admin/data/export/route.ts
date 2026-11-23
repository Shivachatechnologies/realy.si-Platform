import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { exportDataset, exportInput } from "@/server/modules/admin/data-ops";

/** Managed CSV export of one operational dataset (platform.data.export, MFA-gated; reason; production phrase). */
export const POST = route({ auth: "required", name: "POST /admin/data/export", rateLimits: LIMITS.admin }, async ({ req, ctx }) => {
  const r = await exportDataset(ctx, await body(req, exportInput));
  return new Response(r.csv, {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${r.filename}"`, "cache-control": "no-store", "x-export-rows": String(r.rows) },
  });
});
