import type { StatusToneMap } from "./types";

/** Stream D — subscriptions, invoices, payments, refunds, disputes, credit ledger kinds, plans. */
export const tonesD: StatusToneMap = {
  subscription: { ACTIVE: "success", TRIALING: "accent", PAST_DUE: "warning", UNPAID: "danger", CANCELED: "neutral", PAUSED: "warning", INCOMPLETE: "warning", INCOMPLETE_EXPIRED: "neutral" },
  invoice: { draft: "neutral", open: "info", paid: "success", uncollectible: "danger", void: "neutral" },
  payment: { succeeded: "success", pending: "info", failed: "danger", refunded: "neutral", partially_refunded: "warning", disputed: "danger" },
  refund: { pending: "info", requires_action: "warning", succeeded: "success", failed: "danger", canceled: "neutral" },
  dispute: { warning_needs_response: "danger", needs_response: "danger", warning_under_review: "warning", under_review: "warning", warning_closed: "neutral", won: "success", lost: "danger", prevented: "success" },
  creditLedger: { GRANT: "info", PURCHASE: "success", USAGE: "neutral", EXPIRY: "warning", REFUND: "accent", ADJUSTMENT: "brand", PROMOTION: "accent" },
  billingPlan: { DRAFT: "neutral", ACTIVE: "success", DISABLED: "danger" },
};
