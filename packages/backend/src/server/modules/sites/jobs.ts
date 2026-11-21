import type { ModuleJobs } from "@/server/core/module-jobs";
import { publishScheduledPages } from "./service";

/**
 * Background work of the sites module (registered in src/worker/modules.ts): every minute, scheduled pages whose time
 * has come are published (site.published is emitted). The job name carries the "marketing." prefix so the platform's
 * marketing kill switch pauses it.
 */
export const SITES_JOBS: ModuleJobs = {
  periodic: [{ name: "marketing.sites_publish_scheduled", everyMs: 60_000, run: publishScheduledPages }],
  onEvent: [],
};
