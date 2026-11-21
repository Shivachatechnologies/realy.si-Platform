import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createTaskInput, createWorkTask, listWorkTasks, parseTaskFilters } from "@/server/modules/work/tasks";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => listWorkTasks(ctx, orgId, companyId, parseTaskFilters(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/tasks", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) => createWorkTask(ctx, orgId, companyId, await body(req, createTaskInput)));
