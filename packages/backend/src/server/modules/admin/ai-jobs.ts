import type { ModuleJobs } from "@/server/core/module-jobs";
import { flushAiRequestLogs, purgeAiRequestLogs } from "./ai-request-log";

/**
 * Background work of the admin AI platform (stream C). Register ADMIN_C_JOBS in src/worker/modules.ts (stream E).
 * - Retention of the AI request log: rows older than 30 days are deleted in bounded batches, hourly (DB only, no
 *   Redis beyond the scheduler's own tick).
 */
export const ADMIN_C_JOBS: ModuleJobs = {
  periodic: [
    {
      name: "admin.ai_request_logs_retention",
      everyMs: 60 * 60_000,
      run: async () => {
        await flushAiRequestLogs();
        return purgeAiRequestLogs();
      },
    },
  ],
  onEvent: [],
};
