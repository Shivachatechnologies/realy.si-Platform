import type { StatusToneMap } from "./types";

/** Stream E — jobs, health, incidents, alerts, errors, logs. */
export const tonesE: StatusToneMap = {
  jobRun: { ACTIVE: "info", RETRYING: "warning", SUCCEEDED: "success", FAILED: "danger", DEAD: "danger", REQUEUED: "neutral" },
  serviceHealth: { OPERATIONAL: "success", HEALTHY: "success", DEGRADED: "warning", CRITICAL: "danger", DOWN: "danger", MAINTENANCE: "info", UNKNOWN: "neutral", NOT_CONFIGURED: "neutral" },
  incident: { DETECTED: "danger", INVESTIGATING: "warning", IDENTIFIED: "warning", MITIGATING: "info", MONITORING: "info", RESOLVED: "success", CLOSED: "neutral" },
  incidentSeverity: { SEV1: "danger", SEV2: "danger", SEV3: "warning", SEV4: "info" },
  alert: { OPEN: "danger", ACKNOWLEDGED: "warning", SNOOZED: "neutral", RESOLVED: "success" },
  alertSeverity: { INFO: "info", WARNING: "warning", CRITICAL: "danger" },
  errorGroup: { OPEN: "danger", ACKNOWLEDGED: "warning", RESOLVED: "success", IGNORED: "neutral", REGRESSED: "danger" },
  logLevel: { info: "info", warn: "warning", error: "danger" },
  liveJob: { waiting: "info", active: "accent", delayed: "neutral", failed: "danger", completed: "success", prioritized: "info", "waiting-children": "neutral" },
};
