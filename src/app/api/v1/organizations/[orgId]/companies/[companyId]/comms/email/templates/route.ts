import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { listTemplates, saveTemplate, templateInput } from "@/server/modules/comms/email";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listTemplates(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/email/templates", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => saveTemplate(ctx, orgId, companyId, null, await body(req, templateInput)),
);
