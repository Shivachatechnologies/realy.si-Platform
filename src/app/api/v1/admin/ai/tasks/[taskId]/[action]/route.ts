import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { adminTaskAction, taskActionInput } from "@/server/modules/admin/ai";

/** Cancel or retry any organization's AI task (platform.ai.manage). */
export const POST = route<{ taskId: string; action: string }>({ auth: "required", name: "POST /admin/ai/tasks/:id/:action", rateLimits: LIMITS.admin }, async ({ req, ctx }, { taskId, action }) => {
  if (action !== "cancel" && action !== "retry") throw notFound("Action");
  return adminTaskAction(ctx, taskId, action, await body(req, taskActionInput));
});
