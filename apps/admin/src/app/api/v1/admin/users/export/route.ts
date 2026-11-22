import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { z } from "zod";
import { exportPlatformUsersCsv } from "@/server/modules/admin/users";

/** CSV of the filtered user directory (platform.data.export, audited with a reason; ≤ 10,000 rows). */
export const POST = route({ auth: "required", name: "POST /admin/users/export", rateLimits: LIMITS.admin }, async ({ req, ctx }) => {
  const input = await body(req, z.object({ reason: z.string(), filters: z.record(z.string(), z.string()).default({}) }));
  const { csv } = await exportPlatformUsersCsv(ctx, { ...input.filters, reason: input.reason });
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="realy-users-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
  });
});
