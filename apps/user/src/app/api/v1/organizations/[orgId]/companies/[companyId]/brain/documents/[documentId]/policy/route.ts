import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { documentPolicyInput, getDocumentPolicy, setDocumentPolicy } from "@/server/modules/brain/memory-store";

type P = { orgId: string; companyId: string; documentId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, documentId }) => getDocumentPolicy(ctx, orgId, companyId, documentId));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/brain/documents/:id/policy", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, documentId }) => setDocumentPolicy(ctx, orgId, companyId, documentId, await body(req, documentPolicyInput)),
);
