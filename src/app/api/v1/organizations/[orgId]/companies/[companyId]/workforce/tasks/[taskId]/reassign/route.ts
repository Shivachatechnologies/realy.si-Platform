import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { reassignAiTask, reassignInput } from "@/server/modules/workforce/service";

export const POST = route<{ orgId: string; companyId: string; taskId: string }>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/workforce/tasks/:id/reassign", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, taskId }) => reassignAiTask(ctx, orgId, companyId, taskId, await body(req, reassignInput)),
);
