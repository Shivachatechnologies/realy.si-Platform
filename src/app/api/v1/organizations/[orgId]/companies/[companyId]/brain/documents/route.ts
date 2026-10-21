import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { ingestDocument, ingestDocumentInput, listDocuments } from "@/server/modules/brain/service";
import { MAX_PDF_BYTES } from "@/server/modules/brain/extract";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  listDocuments(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
);
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/brain/documents",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
    // A base64-encoded PDF at the size limit plus metadata (text documents are far smaller).
    maxBodyBytes: Math.ceil((MAX_PDF_BYTES * 4) / 3) + 64 * 1024,
  },
  async ({ req, ctx }, { orgId, companyId }) => ingestDocument(ctx, orgId, companyId, await body(req, ingestDocumentInput)),
);
