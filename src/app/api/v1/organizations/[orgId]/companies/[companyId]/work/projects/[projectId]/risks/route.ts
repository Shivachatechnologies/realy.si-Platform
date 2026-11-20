import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createRisk, riskInput } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; projectId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/risks", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => createRisk(ctx, orgId, companyId, projectId, await body(req, riskInput)));
