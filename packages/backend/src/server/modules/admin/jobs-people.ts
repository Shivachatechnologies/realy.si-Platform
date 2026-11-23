import type { ModuleJobs } from "@/server/core/module-jobs";
import { sweepImpersonations } from "./impersonation";
import { purgeDueDeletions, sweepExpiredPlatformGrants } from "./users";

/**
 * Background work of the people & access admin (stream B). Registered by stream E in src/worker/modules.ts.
 * One combined, database-only job every 15 minutes (one BullMQ scheduler tick, so Redis cost stays flat):
 *   - purge accounts whose deletion grace period ended (anonymization, bounded batch);
 *   - delete expired temporary platform grants (they already grant nothing) with one audit row each;
 *   - mark expired impersonations ended and revoke their sessions (those sessions already expire on their own).
 */
export const PEOPLE_JOBS: ModuleJobs = {
  periodic: [
    {
      name: "admin.people-maintenance",
      everyMs: 15 * 60_000,
      run: async () => {
        const now = new Date();
        return (await purgeDueDeletions(now)) + (await sweepExpiredPlatformGrants(now)) + (await sweepImpersonations(now));
      },
    },
  ],
  onEvent: [],
};
