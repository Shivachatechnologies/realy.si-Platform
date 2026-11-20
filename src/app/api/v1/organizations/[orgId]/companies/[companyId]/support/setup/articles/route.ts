import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { draftArticle, draftArticleInput } from "@/server/modules/support/setup";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/setup/articles", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  draftArticle(ctx, orgId, companyId, await body(req, draftArticleInput)),
);
