import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { rankInput, recordRank } from "@/server/modules/marketing/seo";

type P = { orgId: string; companyId: string; keywordId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/seo/keywords/:keywordId/ranks", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, keywordId }) => recordRank(ctx, orgId, companyId, keywordId, await body(req, rankInput)));
