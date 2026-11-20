import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { articleInput, createArticle, listArticles } from "@/server/modules/support/kb";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listArticles(ctx, orgId, companyId, { q: req.nextUrl.searchParams.get("q") ?? undefined, categoryId: req.nextUrl.searchParams.get("category") ?? undefined, page: Number(req.nextUrl.searchParams.get("page")) || 1 }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/kb/articles", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createArticle(ctx, orgId, companyId, await body(req, articleInput)),
);
