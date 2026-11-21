import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { pauseInput, setCompanyAiPaused } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string };

/** "Pause all AI" for the company (or resume). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/autonomy/pause", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setCompanyAiPaused(ctx, orgId, companyId, await body(req, pauseInput)),
);
