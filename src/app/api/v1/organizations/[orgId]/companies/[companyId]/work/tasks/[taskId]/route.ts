import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveWorkTask, getWorkTask, updateTaskInput, updateWorkTask } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string; taskId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, taskId }) => getWorkTask(ctx, orgId, companyId, taskId));
export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/work/tasks/:taskId", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, taskId }) => updateWorkTask(ctx, orgId, companyId, taskId, await body(req, updateTaskInput)));
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/work/tasks/:taskId", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, taskId }) => archiveWorkTask(ctx, orgId, companyId, taskId));
