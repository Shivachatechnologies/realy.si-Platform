import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addRunDocument, runDocumentInput } from "@/server/modules/builder/blueprint";
import { MAX_PDF_BYTES } from "@/server/modules/brain/extract";

type P = { orgId: string; companyId: string; runId: string };

/** POST { title?, filename, content | contentBase64 } — a founder document for the run, added to Company Brain. */
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/sources",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
    maxBodyBytes: Math.ceil((MAX_PDF_BYTES * 4) / 3) + 64 * 1024,
  },
  async ({ req, ctx }, { orgId, companyId, runId }) => addRunDocument(ctx, orgId, companyId, runId, await body(req, runDocumentInput)),
);
