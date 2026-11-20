import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { actOnInsight } from "@/server/modules/growth/service";

/** Assign AI work for an open insight (the responsible AI employee). */
export const POST = route<{ orgId: string; companyId: string; insightId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/growth/insights/:id/act", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, insightId }) => actOnInsight(ctx, orgId, companyId, insightId),
);
