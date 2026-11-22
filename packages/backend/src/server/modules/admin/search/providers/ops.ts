import { defineSearchProvider } from "../types";

/** Stream E: jobs, incidents, alerts, errors. No groups yet (Step 0 placeholder). */
export const opsSearch = defineSearchProvider({
  group: "ops",
  perms: ["platform.controls.manage", "platform.security.read", "platform.audit.read", "platform.incidents.read"],
  empty: {},
  async search() {
    return {};
  },
});
