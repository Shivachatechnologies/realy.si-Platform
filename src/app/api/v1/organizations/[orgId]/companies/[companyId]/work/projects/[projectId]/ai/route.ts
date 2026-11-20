import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { projectAiInput, startProjectAi } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; projectId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => startProjectAi(ctx, orgId, companyId, projectId, await body(req, projectAiInput)));
