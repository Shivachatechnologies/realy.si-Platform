import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { agentPatch, archiveAgent, getAgent, updateAgent } from "@/server/modules/voice/agents";

type P = { orgId: string; companyId: string; agentId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, agentId }) => getAgent(ctx, orgId, companyId, agentId));
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/voice/agents/:agentId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, agentId }) => updateAgent(ctx, orgId, companyId, agentId, await body(req, agentPatch)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/voice/agents/:agentId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, agentId }) => archiveAgent(ctx, orgId, companyId, agentId),
);
