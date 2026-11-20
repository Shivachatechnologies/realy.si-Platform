import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteDocument, getDocumentFile } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string; id: string };

/** Download an employee document (HR managers and the employee only). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => {
  const doc = await getDocumentFile(ctx, orgId, companyId, id);
  return new Response(new Uint8Array(doc.content), {
    headers: {
      "content-type": doc.mimeType,
      "content-length": String(doc.sizeBytes),
      "content-disposition": `attachment; filename="${doc.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/documents/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, id }) => deleteDocument(ctx, orgId, companyId, id),
);
