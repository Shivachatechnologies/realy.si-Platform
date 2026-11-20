import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteKeyword, updateKeyword, updateKeywordInput } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string; keywordId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/seo/keywords/:keywordId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, keywordId }) => updateKeyword(ctx, orgId, companyId, keywordId, await body(req, updateKeywordInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/seo/keywords/:keywordId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, keywordId }) => deleteKeyword(ctx, orgId, companyId, keywordId));
