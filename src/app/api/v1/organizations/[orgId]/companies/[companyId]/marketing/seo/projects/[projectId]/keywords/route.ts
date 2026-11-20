import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addKeywords, keywordsBody } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string; projectId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/seo/projects/:projectId/keywords", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => {
  const B = await body(req, keywordsBody);
  return addKeywords(ctx, orgId, companyId, projectId, "keywords" in B ? B.keywords : [B]);
});
