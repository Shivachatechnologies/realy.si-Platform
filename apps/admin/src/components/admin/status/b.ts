import type { StatusToneMap } from "./types";

/** Stream B — users and organizations (the tones the directory pages use today). */
export const tonesB: StatusToneMap = {
  user: { ACTIVE: "success", SUSPENDED: "warning", DELETED: "danger" },
  organization: { ACTIVE: "success", SUSPENDED: "danger", CLOSED: "neutral" },
};
