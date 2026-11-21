import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { archiveTemplate } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string; templateId: string };
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/creative/templates/:templateId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, templateId }) => archiveTemplate(ctx, orgId, companyId, templateId));
