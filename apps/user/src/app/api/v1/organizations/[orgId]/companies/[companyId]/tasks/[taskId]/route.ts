import { route } from "@/server/core/http";
import { getTask } from "@/server/modules/agents/service";

export const GET = route<{ orgId: string; companyId: string; taskId: string }>({ auth: "required" }, async ({ ctx }, { orgId, companyId, taskId }) =>
  getTask(ctx, orgId, companyId, taskId),
);
