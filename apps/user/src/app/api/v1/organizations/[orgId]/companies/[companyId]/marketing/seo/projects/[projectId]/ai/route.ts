import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { aiRequestInput, requestAi } from "@/server/modules/marketing/ai";

type P = { orgId: string; companyId: string; projectId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/seo/projects/:projectId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => requestAi(ctx, orgId, companyId, projectId, await body(req, aiRequestInput), "seo_project"));
