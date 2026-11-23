import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getWorkflowRunAdmin, runActionInput, workflowRunAction } from "@/server/modules/admin/workflows-admin";

type P = { runId: string };

export const GET = route<P>({ auth: "required", name: "GET /admin/workflows/runs/:id" }, async ({ ctx }, { runId }) => getWorkflowRunAdmin(ctx, runId));

/** Cancel or retry one workflow run (platform.ai.manage, reason, audited). */
export const POST = route<P>({ auth: "required", name: "POST /admin/workflows/runs/:id", rateLimits: LIMITS.admin }, async ({ req, ctx }, { runId }) => workflowRunAction(ctx, runId, await body(req, runActionInput)));
