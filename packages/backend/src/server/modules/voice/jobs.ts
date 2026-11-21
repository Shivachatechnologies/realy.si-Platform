import type { ModuleJobs } from "@/server/core/module-jobs";
import { dialDueCalls, expireStuckCalls, reconcileApprovals } from "./calls";
import { completeCampaigns } from "./campaigns";
import { processCall, processStaleCalls } from "./outcomes";
import { backfillCallCosts } from "./live";
import { advanceRuns } from "./runs";

/**
 * Background work of the phone team, run by the worker (src/worker/modules.ts). Job names start with "comms." so the
 * Communication module kill switch (Admin → Platform Controls) also stops them.
 */
export const VOICE_JOBS: ModuleJobs = {
  periodic: [
    {
      name: "comms.voice-dialer",
      everyMs: 60_000,
      async run() {
        const placed = await dialDueCalls();
        const completed = await completeCampaigns();
        // Calling runs: roll up targets, write reports for finished campaigns, close rejected approvals.
        const runs = await advanceRuns();
        return placed + completed + runs;
      },
    },
    {
      name: "comms.voice-maintenance",
      everyMs: 5 * 60_000,
      async run() {
        return (await reconcileApprovals()) + (await processStaleCalls()) + (await expireStuckCalls()) + (await backfillCallCosts());
      },
    },
  ],
  onEvent: [],
  tasks: [
    {
      name: "comms.voice-process-call",
      attempts: 5,
      async run(data) {
        return typeof data.callId === "string" ? processCall(data.callId) : 0;
      },
    },
  ],
};
