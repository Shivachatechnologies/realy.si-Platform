import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { researchKeywordsToSeo, researchToSeoInput } from "@/server/modules/marketing/research-reports";

type P = { orgId: string; companyId: string; reportId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/research/:reportId/seo", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, reportId }) => researchKeywordsToSeo(ctx, orgId, companyId, reportId, await body(req, researchToSeoInput)));
