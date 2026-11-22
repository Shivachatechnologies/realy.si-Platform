import type { StatusToneMap } from "./types";

/** Stream D — subscriptions, invoices, payments (subscription tones as on /subscriptions today). */
export const tonesD: StatusToneMap = {
  subscription: { ACTIVE: "success", TRIALING: "accent", PAST_DUE: "warning", UNPAID: "danger", CANCELED: "neutral" },
};
