import type { ModuleJobs } from "@/server/core/module-jobs";
import { runCreativePipelines } from "./pipeline";

/**
 * Background work of the creative studio (registered in src/worker/modules.ts): polls provider jobs (scene clips,
 * renders) of WAITING_PROVIDER steps and advances projects with auto-run on, one step per project per tick.
 * Named "marketing.*" so the marketing platform switch and background-job pause apply.
 */
export const CREATIVE_JOBS: ModuleJobs = {
  periodic: [{ name: "marketing.creative_pipelines", everyMs: 30_000, run: runCreativePipelines }],
  onEvent: [],
};
