import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteHook, getHookWithDeliveries, hookUpdateInput, updateHook } from "@/server/modules/integrations/webhooks";

type P = { orgId: string; companyId: string; hookId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, hookId }) => getHookWithDeliveries(ctx, orgId, companyId, hookId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/integration-hooks/:hookId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, hookId }) => updateHook(ctx, orgId, companyId, hookId, await body(req, hookUpdateInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/integration-hooks/:hookId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, hookId }) => deleteHook(ctx, orgId, companyId, hookId),
);
