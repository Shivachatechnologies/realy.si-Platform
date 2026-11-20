import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyArticle, articleApplyInput } from "@/server/modules/marketing/seo-autopilot";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/article", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => applyArticle(ctx, orgId, companyId, contentId, await body(req, articleApplyInput)));
