import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { adminExportCompanyData, adminExportInput } from "@/server/modules/admin/tenants";

/** Stream one company's data export (platform.data.export, audited with a reason). */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/organizations/:id/export", rateLimits: LIMITS.admin, maxBodyBytes: 4096 }, async ({ req, ctx }, { orgId }) => {
  const { stream, filename } = await adminExportCompanyData(ctx, orgId, await body(req, adminExportInput));
  return new Response(stream, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "cache-control": "no-store" } });
});
