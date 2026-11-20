import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { discardJobRun, jobActionInput, requeueJobRun } from "@/server/core/job-admin";

/** Requeue or discard a dead-lettered job (platform.controls.manage; audited with the given reason). */
export const POST = route<{ runId: string; action: string }>({ auth: "required", name: "POST /admin/jobs/:runId/:action", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { runId, action }) => {
  if (action !== "requeue" && action !== "discard") throw notFound("Action");
  const input = await body(req, jobActionInput);
  return action === "requeue" ? requeueJobRun(ctx, runId, input) : discardJobRun(ctx, runId, input);
});
