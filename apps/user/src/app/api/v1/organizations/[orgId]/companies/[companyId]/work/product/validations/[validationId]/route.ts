import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteValidation, updateValidation, updateValidationInput } from "@/server/modules/work/product-research";

type P = { orgId: string; companyId: string; validationId: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/product/validations/:validationId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, validationId }) => updateValidation(ctx, orgId, companyId, validationId, await body(req, updateValidationInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/product/validations/:validationId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, validationId }) => deleteValidation(ctx, orgId, companyId, validationId));

