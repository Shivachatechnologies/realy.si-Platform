import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteAgendaTemplate, updateAgendaTemplate, updateAgendaTemplateInput } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string; templateId: string };
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/agenda-templates/:templateId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, templateId }) => updateAgendaTemplate(ctx, orgId, companyId, templateId, await body(req, updateAgendaTemplateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/agenda-templates/:templateId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, templateId }) => deleteAgendaTemplate(ctx, orgId, companyId, templateId),
);
