import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { autopilotAction, autopilotActionInput } from "@/server/modules/marketing/autopilot";

type P = { orgId: string; companyId: string; autopilotId: string };
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/autopilots/:autopilotId/actions", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, autopilotId }) => autopilotAction(ctx, orgId, companyId, autopilotId, await body(req, autopilotActionInput)));
