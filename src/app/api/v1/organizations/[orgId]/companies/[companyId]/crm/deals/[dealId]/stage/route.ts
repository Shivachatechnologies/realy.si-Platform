import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { moveDealStage, moveStageInput } from "@/server/modules/crm/deals";

type P = { orgId: string; companyId: string; dealId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/deals/:dealId/stage", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, dealId }) => moveDealStage(ctx, orgId, companyId, dealId, await body(req, moveStageInput)),
);
