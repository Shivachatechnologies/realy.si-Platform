import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { jobControlInput, runSchedulerNow } from "@/server/core/job-admin";

/** Run one recurring job now (platform.controls.manage; reason; typed confirmation). */
export const POST = route<{ name: string }>({ auth: "required", name: "POST /admin/jobs/schedulers/:name", rateLimits: LIMITS.admin, idempotent: true }, async ({ req, ctx }, { name }) =>
  runSchedulerNow(ctx, decodeURIComponent(name), await body(req, jobControlInput)),
);
