import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retryTask } from "@/server/modules/agents/service";

export const POST = route<{ orgId: string; companyId: string; taskId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/tasks/:id/retry", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, taskId }) => retryTask(ctx, orgId, companyId, taskId),
);
