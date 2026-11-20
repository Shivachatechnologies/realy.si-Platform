import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { generateDocInput, generateHrDocument } from "@/server/modules/hr/doc-templates";

type P = { orgId: string; companyId: string };

/** Generate an HR letter from a template and store it with the employee's documents. */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/hr/documents/generate", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  generateHrDocument(ctx, orgId, companyId, await body(req, generateDocInput)),
);
