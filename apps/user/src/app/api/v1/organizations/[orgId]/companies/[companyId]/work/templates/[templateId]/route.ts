import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { deleteTemplate } from "@/server/modules/work/projects";

type P = { orgId: string; companyId: string; templateId: string };

export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/templates/:templateId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, templateId }) => deleteTemplate(ctx, orgId, companyId, templateId));
