import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveAutopilot, getAutopilot, updateAutopilot, updateAutopilotInput } from "@/server/modules/marketing/autopilot";

type P = { orgId: string; companyId: string; autopilotId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, autopilotId }) => getAutopilot(ctx, orgId, companyId, autopilotId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/marketing/autopilots/:autopilotId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, autopilotId }) => updateAutopilot(ctx, orgId, companyId, autopilotId, await body(req, updateAutopilotInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/marketing/autopilots/:autopilotId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, autopilotId }) => archiveAutopilot(ctx, orgId, companyId, autopilotId));
