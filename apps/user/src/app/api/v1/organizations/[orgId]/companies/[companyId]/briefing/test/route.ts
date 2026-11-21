import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { sendTestBriefing, testInput } from "@/server/modules/briefing/service";

type P = { orgId: string; companyId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/briefing/test", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => sendTestBriefing(ctx, orgId, companyId, await body(req, testInput)),
);
