import { UnrecoverableError, type Job } from "bullmq";
import { hostname } from "node:os";
import { db, type Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { WORKER_QUEUES } from "@/server/core/jobs";

/**
 * Persisted job status and execution log (worker_job_runs). Every write is best effort: tracking must never fail or
 * slow down a job. Job data is never stored — only names, attempts, timings, counts and secret-free error messages.
 */

export const WORKER_ID = `${hostname()}:${process.pid}`;

const MAX_LOGS = 40;
const MAX_ERROR = 500;

type Status = "ACTIVE" | "RETRYING" | "SUCCEEDED" | "FAILED" | "DEAD";

export type DeadLetterSink = (job: Job, reason: string) => Promise<void>;

export interface TrackOptions {
  queue: string;
  /** "always": every attempt is recorded. "work_or_failure": only runs that did work, failed or retried (periodic ticks). */
  persist: "always" | "work_or_failure";
  /** Tenant of the job, when its data names one (never required). */
  organizationOf?: (data: unknown) => string | null | undefined;
  /** Moves a job whose final attempt failed to the dead-letter queue. */
  deadLetter?: DeadLetterSink | null;
  /** Display name for the run (default: the BullMQ job name). */
  nameOf?: (job: Job) => string;
  /** Never persist error messages (jobs handling personal data, e.g. email addresses). */
  redactErrors?: boolean;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, MAX_ERROR);

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

interface Entry {
  status: Status;
  message: string;
  level: "info" | "warn" | "error";
  error?: string | null;
  result?: number | null;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  deadLettered?: boolean;
}

async function record(job: Job, opts: TrackOptions, e: Entry): Promise<void> {
  const jobId = String(job.id ?? "");
  if (!jobId) return;
  try {
    const where = { queue_jobId: { queue: opts.queue, jobId } };
    const existing = await db().workerJobRun.findUnique({ where, select: { logs: true } });
    const prior = Array.isArray(existing?.logs) ? (existing.logs as Prisma.JsonArray) : [];
    const logs = [...prior, { at: new Date().toISOString(), level: e.level, message: e.message.slice(0, 300) }].slice(-MAX_LOGS) as Prisma.InputJsonValue;
    const org = opts.organizationOf?.(job.data);
    const common = {
      status: e.status,
      attempts: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? 1,
      logs,
      workerId: WORKER_ID,
      ...(e.error !== undefined ? { lastError: e.error } : {}),
      ...(e.result !== undefined ? { result: e.result } : {}),
      ...(e.startedAt ? { startedAt: e.startedAt } : {}),
      ...(e.finishedAt ? { finishedAt: e.finishedAt } : {}),
      ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
      ...(e.deadLettered ? { deadLetteredAt: new Date() } : {}),
    };
    await db().workerJobRun.upsert({
      where,
      create: { queue: opts.queue, jobId, jobName: (opts.nameOf?.(job) ?? job.name).slice(0, 200), organizationId: isUuid(org) ? org : null, ...common },
      update: common,
    });
  } catch (err) {
    logger.warn({ queue: opts.queue, jobId, err: errorMessage(err) }, "job run tracking failed");
  }
}

/** Wrap a BullMQ processor with status tracking, retry bookkeeping and dead-lettering of final failures. */
export function tracked<T, R>(opts: TrackOptions, fn: (job: Job<T>) => Promise<R>): (job: Job<T>) => Promise<R> {
  const requeueable = WORKER_QUEUES.find((q) => q.name === opts.queue)?.requeueable ?? false;
  return async (job: Job<T>) => {
    const attempt = job.attemptsMade + 1;
    const max = job.opts.attempts ?? 1;
    const startedAt = new Date();
    if (opts.persist === "always") await record(job as Job, opts, { status: "ACTIVE", level: "info", message: `Attempt ${attempt}/${max} started on ${WORKER_ID}`, startedAt });
    try {
      const result = await fn(job);
      const n = typeof result === "number" && Number.isFinite(result) ? Math.round(result) : null;
      if (opts.persist === "always" || (n ?? 0) > 0 || attempt > 1) {
        const durationMs = Date.now() - startedAt.getTime();
        await record(job as Job, opts, {
          status: "SUCCEEDED",
          level: "info",
          message: `Succeeded in ${durationMs} ms${n ? ` · ${n} item(s)` : ""}`,
          error: null,
          result: n,
          startedAt: opts.persist === "always" ? undefined : startedAt,
          finishedAt: new Date(),
          durationMs,
        });
      }
      return result;
    } catch (err) {
      const message = opts.redactErrors ? `${err instanceof Error ? err.name : "Error"} (details withheld: the job handles personal data)` : errorMessage(err);
      const final = attempt >= max || err instanceof UnrecoverableError;
      let status: Status = final ? "FAILED" : "RETRYING";
      let deadLettered = false;
      if (final && requeueable && opts.deadLetter) {
        try {
          await opts.deadLetter(job as Job, message);
          status = "DEAD";
          deadLettered = true;
        } catch (dlqErr) {
          logger.error({ queue: opts.queue, jobId: job.id, err: errorMessage(dlqErr) }, "dead-letter move failed");
        }
      }
      const durationMs = Date.now() - startedAt.getTime();
      await record(job as Job, opts, {
        status,
        level: final ? "error" : "warn",
        message: final ? `Attempt ${attempt}/${max} failed (final${deadLettered ? ", moved to dead-letter queue" : ""}): ${message}` : `Attempt ${attempt}/${max} failed, retrying with backoff: ${message}`,
        error: message,
        startedAt: opts.persist === "always" ? undefined : startedAt,
        finishedAt: final ? new Date() : undefined,
        durationMs,
        deadLettered,
      });
      throw err;
    }
  };
}
