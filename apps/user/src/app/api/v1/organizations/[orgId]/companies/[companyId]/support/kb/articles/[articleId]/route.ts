import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteArticle, getArticle, updateArticle, updateArticleInput } from "@/server/modules/support/kb";

type P = { orgId: string; companyId: string; articleId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, articleId }) => getArticle(ctx, orgId, companyId, articleId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/kb/articles/:articleId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, articleId }) => updateArticle(ctx, orgId, companyId, articleId, await body(req, updateArticleInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/kb/articles/:articleId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, articleId }) => deleteArticle(ctx, orgId, companyId, articleId),
);
