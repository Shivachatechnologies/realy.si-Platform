import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { refreshKnowledge } from "@/server/modules/voice/agents";

type P = { orgId: string; companyId: string; agentId: string };

export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/agents/:agentId/knowledge", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ ctx }, { orgId, companyId, agentId }) => refreshKnowledge(ctx, orgId, companyId, agentId),
);
