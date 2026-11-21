import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getSubscription, saveSubscription, subscriptionInput } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getSubscription(ctx, orgId, companyId));
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/briefing/settings", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => saveSubscription(ctx, orgId, companyId, await body(req, subscriptionInput)),
);
