import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { jobControlInput, listQueueJobs, queueControlInput, retryAllFailed, setQueuePaused } from "@/server/core/job-admin";

/** GET: live jobs of one queue (?state=waiting|active|delayed|failed|completed&start=). */
export const GET = route<{ queue: string }>({ auth: "required", name: "GET /admin/jobs/queues/:queue" }, async ({ req, ctx }, { queue }) => listQueueJobs(ctx, queue, Object.fromEntries(req.nextUrl.searchParams)));

/** POST ?action=pause|resume|retry-failed (platform.controls.manage; reason; typed confirmation for destructive ones). */
export const POST = route<{ queue: string }>({ auth: "required", name: "POST /admin/jobs/queues/:queue", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { queue }) => {
  const action = req.nextUrl.searchParams.get("action");
  if (action === "pause" || action === "resume") return setQueuePaused(ctx, queue, action === "pause", await body(req, queueControlInput));
  if (action === "retry-failed") return retryAllFailed(ctx, queue, await body(req, jobControlInput));
  throw notFound("Action");
});
