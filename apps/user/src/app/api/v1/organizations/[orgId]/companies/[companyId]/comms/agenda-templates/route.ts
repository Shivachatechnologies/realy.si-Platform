import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { agendaTemplateInput, createAgendaTemplate, listAgendaTemplates } from "@/server/modules/comms/meetings";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listAgendaTemplates(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/agenda-templates", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createAgendaTemplate(ctx, orgId, companyId, await body(req, agendaTemplateInput)),
);
