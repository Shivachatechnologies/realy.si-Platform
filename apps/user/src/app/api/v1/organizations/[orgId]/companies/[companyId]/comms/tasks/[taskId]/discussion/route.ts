import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { discussTask, discussTaskInput, getTaskDiscussion } from "@/server/modules/comms/discussions";

type P = { orgId: string; companyId: string; taskId: string };
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, taskId }) => ({ data: await getTaskDiscussion(ctx, orgId, companyId, taskId) }));
/** Open (or start in the given channel) the task's discussion thread. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/comms/tasks/:taskId/discussion", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, taskId }) => discussTask(ctx, orgId, companyId, taskId, await body(req, discussTaskInput)),
);
