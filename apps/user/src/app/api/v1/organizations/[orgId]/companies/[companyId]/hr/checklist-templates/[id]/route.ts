import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveTemplate, templatePatch, updateTemplate } from "@/server/modules/hr/onboarding";

type P = { orgId: string; companyId: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/hr/checklist-templates/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, id }) => updateTemplate(ctx, orgId, companyId, id, await body(req, templatePatch)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/hr/checklist-templates/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, id }) => archiveTemplate(ctx, orgId, companyId, id));
