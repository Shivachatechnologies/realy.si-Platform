import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { autopilotInput, createAutopilot, listAutopilots } from "@/server/modules/marketing/autopilot";

type P = { orgId: string; companyId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => listAutopilots(ctx, orgId, companyId));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/marketing/autopilots", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createAutopilot(ctx, orgId, companyId, await body(req, autopilotInput)));
