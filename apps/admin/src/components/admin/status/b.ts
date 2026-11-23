import type { StatusToneMap } from "./types";

/** Stream B — users, organizations, impersonation and access reviews. */
export const tonesB: StatusToneMap = {
  user: { ACTIVE: "success", SUSPENDED: "warning", PENDING_DELETION: "danger", DELETED: "neutral" },
  organization: { ACTIVE: "success", SUSPENDED: "danger", CLOSED: "neutral" },
  impersonation: { READ_ONLY: "info", FULL: "danger" },
  accessReview: { OPEN: "info", COMPLETED: "success", CANCELED: "neutral" },
};
