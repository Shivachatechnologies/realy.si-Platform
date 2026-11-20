import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { saveProjectAsTemplate, saveTemplateInput } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; projectId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/projects/:projectId/template", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, projectId }) => saveProjectAsTemplate(ctx, orgId, companyId, projectId, await body(req, saveTemplateInput)));
