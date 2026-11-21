import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyInput, applyToContent } from "@/server/modules/marketing/ai";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/apply-ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => applyToContent(ctx, orgId, companyId, contentId, await body(req, applyInput)));
