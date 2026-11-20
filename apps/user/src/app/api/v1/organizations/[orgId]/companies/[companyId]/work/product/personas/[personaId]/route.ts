import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deletePersona, updatePersona, updatePersonaInput } from "@/server/modules/work/product-research";

type P = { orgId: string; companyId: string; personaId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/personas/:personaId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, personaId }) => updatePersona(ctx, orgId, companyId, personaId, await body(req, updatePersonaInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/product/personas/:personaId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, personaId }) => deletePersona(ctx, orgId, companyId, personaId));

