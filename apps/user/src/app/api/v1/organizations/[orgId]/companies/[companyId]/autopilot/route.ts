import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { autopilotModeInput, getAutopilotRoom, setAutopilotMode } from "@/server/modules/autopilot/service";

type P = { orgId: string; companyId: string };

/** Company Autopilot: company and department modes, live department state from real jobs, run log. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => getAutopilotRoom(ctx, orgId, companyId));

/** Set the company's or a department's mode and schedule window (department mode null = inherit). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/autopilot", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => setAutopilotMode(ctx, orgId, companyId, await body(req, autopilotModeInput)),
);
