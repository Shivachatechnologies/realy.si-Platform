import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { autopilotStatusInput, setAutopilotStatus } from "@/server/modules/crm/prospecting";

type P = { orgId: string; companyId: string; autopilotId: string };

/** Turn an autopilot on (auto-send needs confirmAutoSend: the person approves sending within the caps), pause or archive it. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/prospecting/:autopilotId/status", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, autopilotId }) => setAutopilotStatus(ctx, orgId, companyId, autopilotId, await body(req, autopilotStatusInput)),
);
