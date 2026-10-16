import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { createTask, createTaskInput, listTasks } from "@/server/modules/agents/service";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) =>
  listTasks(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
);
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/tasks", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => createTask(ctx, orgId, companyId, await body(req, createTaskInput)),
);
