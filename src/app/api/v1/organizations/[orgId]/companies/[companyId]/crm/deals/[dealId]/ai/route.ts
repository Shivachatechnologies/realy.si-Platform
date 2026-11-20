import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assistDeal, recordAiInput } from "@/server/modules/crm/ai-assist";

type P = { orgId: string; companyId: string; dealId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/deals/:dealId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, dealId }) => assistDeal(ctx, orgId, companyId, dealId, await body(req, recordAiInput)),
);
