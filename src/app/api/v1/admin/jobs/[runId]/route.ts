import { route } from "@/server/core/http";
import { getJobRun } from "@/server/core/job-admin";

/** One persisted job run with its execution log (never the job payload). */
export const GET = route<{ runId: string }>({ auth: "required", name: "GET /admin/jobs/:runId" }, async ({ ctx }, { runId }) => getJobRun(ctx, runId));
