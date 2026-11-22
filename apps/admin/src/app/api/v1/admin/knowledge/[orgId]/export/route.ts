import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { exportKnowledge, knowledgeExportInput } from "@/server/modules/admin/knowledge-admin";

/** Export one company's knowledge inventory as JSON (platform.data.export, reason, audited). */
export const POST = route<{ orgId: string }>({ auth: "required", name: "POST /admin/knowledge/:orgId/export", rateLimits: LIMITS.admin }, async ({ req, ctx }, { orgId }) => {
  const input = await body(req, knowledgeExportInput);
  const f = await exportKnowledge(ctx, orgId, input.companyId, input.reason);
  return new Response(f.json, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "no-store" } });
});
