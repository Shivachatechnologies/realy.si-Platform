import type { ModuleJobs } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";
import { runDueSyncs } from "./sync";
import { fanOutEvent, retryDueDeliveries } from "./webhooks";

/** Background work of the integrations module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const INTEGRATIONS_JOBS: ModuleJobs = {
  periodic: [
    { name: "integrations.sync", everyMs: 60_000, run: () => runDueSyncs() },
    { name: "integrations.webhook_retries", everyMs: 30_000, run: () => retryDueDeliveries() },
  ],
  onEvent: [
    {
      name: "integrations.outbound_webhooks",
      types: "*",
      async handle(event) {
        // Never throw: the event job is shared with other modules' handlers and would be retried for all of them.
        await fanOutEvent(event).catch((err) => logger.error({ err: err instanceof Error ? err.message : err, eventId: event.id }, "outbound webhook fan-out failed"));
      },
    },
  ],
};
