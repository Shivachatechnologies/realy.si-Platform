import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteDocument, getDocument, updateDocument, updateDocumentInput } from "@/server/modules/brain/service";

type P = { orgId: string; companyId: string; documentId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, documentId }) => getDocument(ctx, orgId, companyId, documentId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/brain/documents/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, documentId }) => updateDocument(ctx, orgId, companyId, documentId, await body(req, updateDocumentInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/brain/documents/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, documentId }) => deleteDocument(ctx, orgId, companyId, documentId),
);
