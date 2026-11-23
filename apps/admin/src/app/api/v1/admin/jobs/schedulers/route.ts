import { route } from "@/server/core/http";
import { listSchedulers } from "@/server/core/job-admin";

/** Recurring jobs (BullMQ job schedulers): interval, next run, last recorded run. */
export const GET = route({ auth: "required", name: "GET /admin/jobs/schedulers" }, async ({ ctx }) => listSchedulers(ctx));
