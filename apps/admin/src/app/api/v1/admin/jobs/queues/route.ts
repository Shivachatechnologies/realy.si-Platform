import { route } from "@/server/core/http";
import { queueStates } from "@/server/core/job-admin";

/** Every queue with its depth and global paused flag (live from Redis, on demand). */
export const GET = route({ auth: "required", name: "GET /admin/jobs/queues" }, async ({ ctx }) => ({ queues: await queueStates(ctx) }));
