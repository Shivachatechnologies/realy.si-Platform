import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { assistAccount, recordAiInput } from "@/server/modules/crm/ai-assist";

type P = { orgId: string; companyId: string; accountId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/accounts/:accountId/ai", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, accountId }) => assistAccount(ctx, orgId, companyId, accountId, await body(req, recordAiInput)),
);
