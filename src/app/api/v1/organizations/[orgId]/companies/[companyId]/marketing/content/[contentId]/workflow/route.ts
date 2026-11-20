import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { contentWorkflow, workflowInput } from "@/server/modules/marketing/content";

type P = { orgId: string; companyId: string; contentId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/content/:contentId/workflow", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, contentId }) => contentWorkflow(ctx, orgId, companyId, contentId, await body(req, workflowInput)));
