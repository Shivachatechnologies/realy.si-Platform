import type { ModuleJobs } from "@/server/core/module-jobs";
import { handleInsightTaskCompleted, runGrowthEngine } from "./service";

/** Growth engine jobs (run through BI_JOBS, which the worker registers). */
export const GROWTH_JOBS: ModuleJobs = {
  // Hourly per company; evaluateCompany also skips companies evaluated within the last 55 minutes.
  periodic: [{ name: "growth.engine", everyMs: 60 * 60_000, run: () => runGrowthEngine() }],
  onEvent: [{ name: "growth.insight-acted", types: ["agent.task.completed"], handle: handleInsightTaskCompleted }],
};
