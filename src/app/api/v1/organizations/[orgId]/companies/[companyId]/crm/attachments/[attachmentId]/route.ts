import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteAttachment, downloadAttachment } from "@/server/modules/crm/activities";

type P = { orgId: string; companyId: string; attachmentId: string };

/** Download (sales.read). Always served as an attachment with nosniff so uploaded HTML/SVG never renders inline. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, attachmentId }) => {
  const a = await downloadAttachment(ctx, orgId, companyId, attachmentId);
  const ascii = a.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": a.mimeType || "application/octet-stream",
      "content-length": String(a.size),
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "sandbox",
    },
  });
});
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/attachments/:attachmentId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, attachmentId }) =>
  deleteAttachment(ctx, orgId, companyId, attachmentId),
);
