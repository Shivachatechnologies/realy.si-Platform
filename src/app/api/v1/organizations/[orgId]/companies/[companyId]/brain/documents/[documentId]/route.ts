import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteDocument, getDocument } from "@/server/modules/brain/service";

type P = { orgId: string; companyId: string; documentId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, documentId }) => getDocument(ctx, orgId, companyId, documentId));
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/brain/documents/:id", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, documentId }) => deleteDocument(ctx, orgId, companyId, documentId),
);
