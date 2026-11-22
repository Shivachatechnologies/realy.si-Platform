import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getWorkflowAdmin, workflowAction, workflowActionInput } from "@/server/modules/admin/workflows-admin";

type P = { workflowId: string };

export const GET = route<P>({ auth: "required", name: "GET /admin/workflows/:id" }, async ({ ctx }, { workflowId }) => getWorkflowAdmin(ctx, workflowId));

/** Enable, pause, archive, clone, test or run one workflow (platform.ai.manage, reason, audited). */
export const POST = route<P>({ auth: "required", name: "POST /admin/workflows/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { workflowId }) => workflowAction(ctx, workflowId, await body(req, workflowActionInput)));
