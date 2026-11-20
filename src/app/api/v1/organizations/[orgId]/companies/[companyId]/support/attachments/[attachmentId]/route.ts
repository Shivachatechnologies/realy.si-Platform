import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteAttachment, getAttachment } from "@/server/modules/support/tickets";

type P = { orgId: string; companyId: string; attachmentId: string };

/** Download (support.read). Always served as an attachment with sniffing disabled. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, attachmentId }) => {
  const a = await getAttachment(ctx, orgId, companyId, attachmentId);
  return new Response(new Uint8Array(a.data), {
    headers: {
      "content-type": a.contentType,
      "content-length": String(a.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/attachments/:attachmentId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, attachmentId }) => deleteAttachment(ctx, orgId, companyId, attachmentId),
);
