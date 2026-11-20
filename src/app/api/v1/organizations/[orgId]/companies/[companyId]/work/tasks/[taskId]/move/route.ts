import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { moveTaskInput, moveWorkTask } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; taskId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/tasks/:taskId/move", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, taskId }) => moveWorkTask(ctx, orgId, companyId, taskId, await body(req, moveTaskInput)));
