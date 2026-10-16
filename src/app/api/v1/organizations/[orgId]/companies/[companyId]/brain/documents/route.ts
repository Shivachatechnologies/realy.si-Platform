import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { ingestDocument, ingestDocumentInput, listDocuments } from "@/server/modules/brain/service";
import { MAX_DOCUMENT_BYTES } from "@/server/modules/brain/extract";

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
    // The text limit plus room for JSON escaping and metadata.
    maxBodyBytes: MAX_DOCUMENT_BYTES * 2,
  },
  async ({ req, ctx }, { orgId, companyId }) => ingestDocument(ctx, orgId, companyId, await body(req, ingestDocumentInput)),
);
