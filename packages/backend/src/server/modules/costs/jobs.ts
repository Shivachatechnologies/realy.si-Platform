import type { ModuleJobs } from "@/server/core/module-jobs";
import { pruneRequestCache, syncIntegrationUsage, syncVoiceCalls } from "./sync";

/** Background work of the costs module (register in src/worker/modules.ts). Database work only — never AI calls. */
export const COSTS_JOBS: ModuleJobs = {
  periodic: [
    // Mirror metered provider spend (integration usage, voice calls) into the unified cost ledger.
    { name: "costs.ledger-sync", everyMs: 5 * 60_000, run: async () => (await syncIntegrationUsage()) + (await syncVoiceCalls()) },
    { name: "costs.cache-prune", everyMs: 60 * 60_000, run: () => pruneRequestCache() },
  ],
  onEvent: [],
};
