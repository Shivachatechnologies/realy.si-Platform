import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createHook, hookInput, listHooks } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listHooks(ctx, orgId, companyId) }));
/** Returns the secret once. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integration-hooks", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createHook(ctx, orgId, companyId, await body(req, hookInput)),
);
