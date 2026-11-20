import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { linkDocument, linkInput, listDocumentLinks } from "@/server/modules/brain/links";

type P = { orgId: string; companyId: string; documentId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, documentId }) => ({ data: await listDocumentLinks(ctx, orgId, companyId, documentId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/brain/documents/:id/links", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, documentId }) => linkDocument(ctx, orgId, companyId, documentId, await body(req, linkInput)),
);
