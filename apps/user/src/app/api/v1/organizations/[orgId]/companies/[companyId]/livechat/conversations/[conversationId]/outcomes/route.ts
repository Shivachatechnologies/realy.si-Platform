import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { outcomesInput, setOutcomes } from "@/server/modules/livechat/inbox";

type P = { orgId: string; companyId: string; conversationId: string };

export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/livechat/conversations/:conversationId/outcomes", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, conversationId }) => setOutcomes(ctx, orgId, companyId, conversationId, await body(req, outcomesInput)),
);
