import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiRequestInput, requestAi } from "@/server/modules/marketing/ai";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => requestAi(ctx, orgId, companyId, contentId, await body(req, aiRequestInput), "marketing_content"));
