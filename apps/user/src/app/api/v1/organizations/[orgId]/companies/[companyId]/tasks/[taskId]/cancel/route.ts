import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { cancelTask } from "@/server/modules/agents/service";

export const POST = route<{ orgId: string; companyId: string; taskId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/tasks/:id/cancel", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, taskId }) => cancelTask(ctx, orgId, companyId, taskId),
);
