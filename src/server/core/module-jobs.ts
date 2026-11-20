import type { OutboxEvent } from "@/server/modules/events/relay";

/** A job the worker runs every `everyMs` (at most one run at a time per process). Must be idempotent. */
export interface PeriodicJob {
  name: string;
  everyMs: number;
  run(): Promise<number | void>;
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
}
