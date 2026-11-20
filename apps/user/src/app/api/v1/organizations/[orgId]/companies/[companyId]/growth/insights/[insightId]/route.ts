import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { insightStatusInput, setInsightStatus } from "@/server/modules/growth/service";

export const PATCH = route<{ orgId: string; companyId: string; insightId: string }>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/growth/insights/:id", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, insightId }) => setInsightStatus(ctx, orgId, companyId, insightId, await body(req, insightStatusInput)),
);
