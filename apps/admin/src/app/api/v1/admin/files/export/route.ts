import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { exportFileMetadata } from "@/server/modules/admin/files-admin";

/** CSV of file metadata (no contents) for one store and filter; audited (platform.data.export or security.manage). */
export const GET = route({ auth: "required", name: "GET /admin/files/export", rateLimits: LIMITS.admin }, async ({ req, ctx }) => {
  const csv = await exportFileMetadata(ctx, Object.fromEntries(req.nextUrl.searchParams));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="realy-files-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
});
