import type { StatusToneMap } from "./types";

/** Stream E — jobs, health, incidents, alerts (job-run tones as on /system/jobs today). */
export const tonesE: StatusToneMap = {
  jobRun: { ACTIVE: "info", RETRYING: "warning", SUCCEEDED: "success", FAILED: "danger", DEAD: "danger", REQUEUED: "neutral" },
};
