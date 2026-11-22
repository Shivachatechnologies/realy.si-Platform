import type { StatusToneMap } from "./types";

/** Stream F — CMS, support tickets, email, webhooks (CMS entry tones as on /cms today). */
export const tonesF: StatusToneMap = {
  cmsEntry: { DRAFT: "warning", SCHEDULED: "info", PUBLISHED: "success", ARCHIVED: "neutral" },
};
