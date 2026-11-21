import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { pauseInput, setCompanyAiPaused } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string };

/** Autopilot "pause all": the company-wide "Pause all AI" switch of the autonomy engine (or resume). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/autopilot/pause", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setCompanyAiPaused(ctx, orgId, companyId, await body(req, pauseInput)),
);
