import { defineSearchProvider } from "../types";

/** Stream D: subscriptions, invoices, payments, plans, promotions. No groups yet (Step 0 placeholder). */
export const billingSearch = defineSearchProvider({
  group: "billing",
  perms: ["pricing.read", "platform.subscriptions.read"],
  empty: {},
  async search() {
    return {};
  },
});
