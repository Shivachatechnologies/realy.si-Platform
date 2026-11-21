import type { OutboxEvent } from "@/server/modules/events/relay";

/**
 * A job the worker runs every `everyMs`. With Redis the worker registers it as a BullMQ job scheduler on the
 * "schedules" queue, so exactly one run happens per tick across all worker replicas (retried with backoff on failure).
 * Must be idempotent. Returns how much work it did (persisted in worker_job_runs when non-zero).
 */
export interface PeriodicJob {
  name: string;
  everyMs: number;
  run(): Promise<number | void>;
}

/**
 * A named unit of work a module hands to the worker queues with `dispatchJob` (src/server/core/jobs.ts). Retried with
 * exponential backoff; after the last attempt it lands in the dead-letter queue. Must be idempotent.
 */
export interface ModuleTask {
  name: string;
  /** Queue the task runs on (default "module-jobs"). */
  queue?: "module-jobs" | "webhooks";
  /** Attempts before dead-lettering (default: the queue's policy). */
  attempts?: number;
  run(data: Record<string, unknown>): Promise<number | void>;
}

/** Reacts to published domain events (at-least-once: handlers must dedupe by event id). */
export interface EventHandler {
  name: string;
  /** Event types this handler wants, or "*" for all. */
  types: readonly string[] | "*";
  handle(event: OutboxEvent): Promise<void>;
}

export interface ModuleJobs {
  periodic: PeriodicJob[];
  onEvent: EventHandler[];
  /** Named tasks other code can dispatch to the worker queues (optional). */
  tasks?: ModuleTask[];
}
