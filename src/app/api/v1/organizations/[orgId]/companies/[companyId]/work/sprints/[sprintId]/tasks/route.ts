import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { setSprintTasks, sprintTasksInput } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; sprintId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/sprints/:sprintId/tasks", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sprintId }) => setSprintTasks(ctx, orgId, companyId, sprintId, await body(req, sprintTasksInput)));
