import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reviewInput, reviewProject } from "@/server/modules/creative/pipeline";

type P = { orgId: string; companyId: string; projectId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/projects/:projectId/review", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => reviewProject(ctx, orgId, companyId, projectId, await body(req, reviewInput)));
