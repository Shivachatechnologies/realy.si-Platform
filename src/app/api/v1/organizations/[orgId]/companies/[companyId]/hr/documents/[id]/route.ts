import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteDocument, getDocumentFile } from "@/server/modules/hr/employees";

type P = { orgId: string; companyId: string; id: string };

/** Download an employee document (HR managers and the employee only). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, id }) => {
  const doc = await getDocumentFile(ctx, orgId, companyId, id);
  // Generated letters (our own escaped HTML) can be viewed in the browser to print; scripts are blocked by the CSP.
  const inline = doc.category === "letter" && doc.mimeType === "text/html" && new URL(req.url).searchParams.get("view") === "1";
  return new Response(new Uint8Array(doc.content), {
    headers: {
      "content-type": inline ? "text/html; charset=utf-8" : doc.mimeType,
      "content-length": String(doc.sizeBytes),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${doc.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      ...(inline ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/documents/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, id }) => deleteDocument(ctx, orgId, companyId, id),
);
