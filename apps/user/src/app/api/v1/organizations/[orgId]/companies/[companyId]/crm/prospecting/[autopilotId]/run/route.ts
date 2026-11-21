import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { runAutopilotNow } from "@/server/modules/crm/prospecting";

type P = { orgId: string; companyId: string; autopilotId: string };

/** Run an active autopilot now (queued on the worker; within the same daily caps as scheduled runs). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/prospecting/:autopilotId/run", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, autopilotId }) => runAutopilotNow(ctx, orgId, companyId, autopilotId),
);
