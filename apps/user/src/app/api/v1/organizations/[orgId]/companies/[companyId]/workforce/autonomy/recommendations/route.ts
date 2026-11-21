import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { applyRecommendation, applyRecommendationInput } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string };

/** Apply a trust recommendation (switch a department's action class to Auto with the recommended daily cap). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/autonomy/recommendations", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => applyRecommendation(ctx, orgId, companyId, await body(req, applyRecommendationInput)),
);
