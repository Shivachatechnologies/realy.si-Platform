import { LIMITS } from "@/server/core/limits";
import { notFound } from "@/server/core/errors";
import { body, route } from "@/server/core/http";
import { cancelLiveJob, inspectJob, jobControlInput, retryLiveJob } from "@/server/core/job-admin";

/** Inspect one live job (no payload values: only their shape). */
export const GET = route<{ queue: string; jobId: string }>({ auth: "required", name: "GET /admin/jobs/queues/:queue/jobs/:jobId" }, async ({ ctx }, { queue, jobId }) => inspectJob(ctx, queue, decodeURIComponent(jobId)));

/** POST ?action=retry|cancel (platform.controls.manage; reason; cancel needs a typed confirmation). */
export const POST = route<{ queue: string; jobId: string }>({ auth: "required", name: "POST /admin/jobs/queues/:queue/jobs/:jobId", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { queue, jobId }) => {
  const action = req.nextUrl.searchParams.get("action");
  const input = await body(req, jobControlInput);
  if (action === "retry") return retryLiveJob(ctx, queue, decodeURIComponent(jobId), input);
  if (action === "cancel") return cancelLiveJob(ctx, queue, decodeURIComponent(jobId), input);
  throw notFound("Action");
});
