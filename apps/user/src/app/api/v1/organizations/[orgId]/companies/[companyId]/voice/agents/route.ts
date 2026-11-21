import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { agentInput, createAgent, listAgents } from "@/server/modules/voice/agents";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listAgents(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/agents", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createAgent(ctx, orgId, companyId, await body(req, agentInput)),
);
