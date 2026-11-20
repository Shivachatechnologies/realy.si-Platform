import type { ModuleJobs } from "@/server/core/module-jobs";
import { applyRetention, closeIdleConversations } from "./lifecycle";

/** Background work of the live chat module, run by the worker (src/worker/modules.ts). */
export const LIVECHAT_JOBS: ModuleJobs = {
  periodic: [
    { name: "livechat.close-idle", everyMs: 5 * 60_000, run: closeIdleConversations },
    { name: "livechat.retention", everyMs: 6 * 60 * 60_000, run: applyRetention },
  ],
  onEvent: [],
};
