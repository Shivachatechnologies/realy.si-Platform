import type { ModuleJobs } from "@/server/core/module-jobs";
import { logger } from "@/server/core/logger";
import { pruneRequestLogs, pruneUsage } from "./service";
import { runDueSyncs, runScheduledSync } from "./sync";
import { runDueHealthChecks, verifyConnection } from "./verify";
import { attemptDelivery, fanOutEvent, retryDueDeliveries } from "./webhooks";

const id = (data: Record<string, unknown>, key: string) => {
  const v = data[key];
  if (typeof v !== "string" || !v) throw new Error(`missing ${key}`);
  return v;
};

/** Background work of the integrations module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const INTEGRATIONS_JOBS: ModuleJobs = {
  periodic: [
    { name: "integrations.sync", everyMs: 60_000, run: () => runDueSyncs() },
    { name: "integrations.webhook_retries", everyMs: 30_000, run: () => retryDueDeliveries() },
    { name: "integrations.health_checks", everyMs: 15 * 60_000, run: () => runDueHealthChecks() },
    { name: "integrations.prune_request_logs", everyMs: 6 * 3_600_000, run: () => pruneRequestLogs() },
    { name: "integrations.prune_usage", everyMs: 24 * 3_600_000, run: () => pruneUsage() },
  ],
  onEvent: [
    {
      name: "integrations.outbound_webhooks",
      types: "*",
      async handle(event) {
        // Never throw: deliveries keep their own retry schedule (attemptDelivery), independent of this handler.
        await fanOutEvent(event).catch((err) => logger.error({ err: err instanceof Error ? err.message : err, eventId: event.id }, "outbound webhook fan-out failed"));
      },
    },
  ],
  tasks: [
    {
      name: "integrations.webhook_delivery",
      queue: "webhooks",
      // HTTP failures are retried by the delivery's own backoff schedule (1 min … 6 h); job retries cover crashes only.
      attempts: 3,
      async run(data) {
        await attemptDelivery(id(data, "deliveryId"));
        return 1;
      },
    },
    { name: "integrations.sync_connection", attempts: 2, run: (data) => runScheduledSync(id(data, "connectionId")) },
    {
      name: "integrations.verify_connection",
      attempts: 2,
      async run(data) {
        const outcome = await verifyConnection(id(data, "connectionId"));
        return outcome === "verified" ? 1 : 0;
      },
    },
  ],
};
