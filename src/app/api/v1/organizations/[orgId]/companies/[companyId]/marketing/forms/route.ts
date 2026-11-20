import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createForm, formInput, listForms } from "@/server/modules/marketing/forms";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listForms(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/forms", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createForm(ctx, orgId, companyId, await body(req, formInput)));
