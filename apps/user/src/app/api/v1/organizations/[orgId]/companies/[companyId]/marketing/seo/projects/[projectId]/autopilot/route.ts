import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { seoAction, seoActionInput } from "@/server/modules/marketing/seo-autopilot";

type P = { orgId: string; companyId: string; projectId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/seo/projects/:projectId/autopilot", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => seoAction(ctx, orgId, companyId, projectId, await body(req, seoActionInput)));
