import { route } from "@/server/core/http";
import { jobsOverview, listJobRuns } from "@/server/core/job-admin";

/**
 * Worker service overview and persisted job runs (platform monitoring permissions).
 * GET /admin/jobs?view=overview → worker health, queue depths, last-24 h outcomes, heartbeats.
 * GET /admin/jobs?status=DEAD&queue=&cursor=&limit= → job runs (DEAD = the dead-letter list).
 */
export const GET = route({ auth: "required", name: "GET /admin/jobs" }, async ({ req, ctx }) => {
  const { view, ...filters } = Object.fromEntries(req.nextUrl.searchParams);
  return view === "overview" ? jobsOverview(ctx) : listJobRuns(ctx, filters);
});
