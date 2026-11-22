import type { StatusToneMap } from "./types";

/** Stream A — shell enums (notifications, action-center items). */
export const tonesA: StatusToneMap = {
  notificationSeverity: { INFO: "info", WARNING: "warning", CRITICAL: "danger" },
  actionSeverity: { critical: "danger", high: "warning", medium: "info", low: "neutral" },
};
