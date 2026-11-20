import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveForm, getForm, updateForm, updateFormInput } from "@/server/modules/marketing/forms";

type P = { orgId: string; companyId: string; formId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, formId }) => getForm(ctx, orgId, companyId, formId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/forms/:formId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, formId }) => updateForm(ctx, orgId, companyId, formId, await body(req, updateFormInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/forms/:formId", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, formId }) => archiveForm(ctx, orgId, companyId, formId));
