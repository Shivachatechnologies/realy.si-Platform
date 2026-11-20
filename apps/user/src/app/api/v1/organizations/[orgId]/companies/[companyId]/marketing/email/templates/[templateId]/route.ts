import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveTemplate, updateTemplate, updateTemplateInput } from "@/server/modules/marketing/email";

type P = { orgId: string; companyId: string; templateId: string };
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/email/templates/:templateId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, templateId }) => updateTemplate(ctx, orgId, companyId, templateId, await body(req, updateTemplateInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/email/templates/:templateId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, templateId }) => archiveTemplate(ctx, orgId, companyId, templateId));
