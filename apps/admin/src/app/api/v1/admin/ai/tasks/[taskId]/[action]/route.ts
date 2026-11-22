import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { adminTaskAction, taskActionInput } from "@/server/modules/admin/ai";
import { adminCancelTask, pauseInput, pauseTask, reassignInput, reassignTask, resumeTask } from "@/server/modules/admin/ai-tasks";

/** Platform task actions (platform.ai.manage, reason required, audited): cancel, retry, pause, resume, reassign. */
export const POST = route<{ taskId: string; action: string }>({ auth: "required", name: "POST /admin/ai/tasks/:id/:action", rateLimits: LIMITS.admin }, async ({ req, ctx }, { taskId, action }) => {
  switch (action) {
    case "cancel":
      return adminCancelTask(ctx, taskId, await body(req, pauseInput));
    case "retry":
      return adminTaskAction(ctx, taskId, "retry", await body(req, taskActionInput));
    case "pause":
      return pauseTask(ctx, taskId, await body(req, pauseInput));
    case "resume":
      return resumeTask(ctx, taskId, await body(req, pauseInput));
    case "reassign":
      return reassignTask(ctx, taskId, await body(req, reassignInput));
    default:
      throw notFound("Action");
  }
});
