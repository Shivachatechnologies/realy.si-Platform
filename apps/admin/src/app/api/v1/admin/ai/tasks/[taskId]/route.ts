import { route } from "@/server/core/http";
import { getAdminTask } from "@/server/modules/admin/ai-tasks";

/** One AI task with steps, tool calls, cost turns, request log, approvals and audit (content needs platform.data.read). */
export const GET = route<{ taskId: string }>({ auth: "required", name: "GET /admin/ai/tasks/:id" }, async ({ ctx }, { taskId }) => getAdminTask(ctx, taskId));
