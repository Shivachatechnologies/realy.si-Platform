import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { composeAutomation, composeInput } from "@/server/modules/automation/compose";

type P = { orgId: string; companyId: string };

/** Natural language → validated workflow definition (preview only; nothing is saved). */
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workflows/compose", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  composeAutomation(ctx, orgId, companyId, await body(req, composeInput)),
);
