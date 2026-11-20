import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteTemplate, saveTemplate, templateInput } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string; templateId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/comms/email/templates/:templateId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, templateId }) => saveTemplate(ctx, orgId, companyId, templateId, await body(req, templateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/comms/email/templates/:templateId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, templateId }) => deleteTemplate(ctx, orgId, companyId, templateId),
);
