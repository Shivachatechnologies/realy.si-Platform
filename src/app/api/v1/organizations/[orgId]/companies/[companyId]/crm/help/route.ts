import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { helpInput, helpMe } from "@/server/modules/crm/guided";

/** "Help me do this": an AI task for the record or page the person is on. */
export const POST = route<{ orgId: string; companyId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/help", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => helpMe(ctx, orgId, companyId, await body(req, helpInput)),
);
