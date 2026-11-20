import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getAutonomyRoom, setAutonomySettings, settingsInput } from "@/server/modules/workforce/autonomy-service";

type P = { orgId: string; companyId: string };

/** The autonomy control room: settings, rules per department and action class, trust, recommendations, auto-approved log. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getAutonomyRoom(ctx, orgId, companyId));

/** Company Auto mode switch and trust thresholds. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/autonomy", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setAutonomySettings(ctx, orgId, companyId, await body(req, settingsInput)),
);
