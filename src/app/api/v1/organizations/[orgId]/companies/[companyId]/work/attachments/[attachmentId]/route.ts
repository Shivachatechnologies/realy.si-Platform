import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteAttachment, getAttachment } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; attachmentId: string };

/** Download (projects.read on the task's project). Served as an attachment with a neutral type unless it is an image/PDF. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, attachmentId }) => {
  const a = await getAttachment(ctx, orgId, companyId, attachmentId);
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.contentType);
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": inline ? a.contentType : "application/octet-stream",
      "content-length": String(a.sizeBytes),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/attachments/:attachmentId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, attachmentId }) => deleteAttachment(ctx, orgId, companyId, attachmentId),
);
