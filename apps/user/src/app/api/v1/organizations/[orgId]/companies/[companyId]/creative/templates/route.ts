import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createTemplate, listTemplates, templateInput } from "@/server/modules/creative/library";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listTemplates(ctx, orgId, companyId) }));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/creative/templates", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createTemplate(ctx, orgId, companyId, await body(req, templateInput)));
