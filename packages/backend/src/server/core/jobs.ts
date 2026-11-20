import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env";
import { AppError } from "./errors";

/**
 * Durable background jobs (BullMQ on Redis), produced by the web app and consumed by the worker
 * (src/worker/index.ts). Used where work must not run on the request path — e.g. password-reset email,
 * whose cost would otherwise reveal whether an account exists.
 */
export const AUTH_EMAIL_QUEUE = "auth-email";

export interface PasswordResetJob {
  email: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Separate key prefix per environment, so test jobs can never be picked up by a development worker. */
export const queuePrefix = () => (env().NODE_ENV === "test" ? "realy-test" : "realy");

let queue: Queue<PasswordResetJob> | null = null;

export function authEmailQueue(): Queue<PasswordResetJob> {
  // Producer connection fails fast while Redis is down (no offline queue), instead of hanging the request.
  queue ??= new Queue<PasswordResetJob>(AUTH_EMAIL_QUEUE, {
    connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2000 }),
    prefix: queuePrefix(),
  });
  return queue;
}

const ENQUEUE_TIMEOUT_MS = 2500;

/** Wait for an enqueue at most ENQUEUE_TIMEOUT_MS; a Redis outage becomes a retryable 503, never a hung request. */
async function enqueueWithTimeout(add: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("enqueue timed out")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([add, timeout]);
  } catch {
    throw new AppError("service_unavailable", "Temporarily unavailable, please retry shortly");
  } finally {
    clearTimeout(timer);
  }
}

/** Enqueue a password-reset job. Job data (an email address) is deleted on completion and 24 h after a failure. */
export async function enqueuePasswordReset(job: PasswordResetJob): Promise<void> {
  await enqueueWithTimeout(
    authEmailQueue().add("password_reset", job, {
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60 },
    }),
  );
}

export const AGENT_TASK_QUEUE = "agent-tasks";

export interface AgentTaskJob {
  taskId: string;
}

let agentQueue: Queue<AgentTaskJob> | null = null;

export function agentTaskQueue(): Queue<AgentTaskJob> {
  agentQueue ??= new Queue<AgentTaskJob>(AGENT_TASK_QUEUE, {
    connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2000 }),
    prefix: queuePrefix(),
  });
  return agentQueue;
}

/**
 * Enqueue one execution of an AI task. `jobId` dedupes (one job per execution); transient model failures are
 * retried by BullMQ with backoff, permanent ones are marked FAILED by the processor.
 */
export async function enqueueAgentTask(taskId: string, jobId: string): Promise<void> {
  await enqueueWithTimeout(
    agentTaskQueue().add("run", { taskId }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 }),
  );
}

// ───────────────────────────── Worker service queues ─────────────────────────────

/** Per-handler processing of published domain events and module tasks (integration syncs, health checks...). */
export const MODULE_JOBS_QUEUE = "module-jobs";
/** Recurring work (module periodic jobs: recurring plans, workflow schedules, syncs...) driven by BullMQ job schedulers. */
export const SCHEDULES_QUEUE = "schedules";
/** Outbound webhook deliveries (signed POSTs to subscriber URLs). */
export const WEBHOOKS_QUEUE = "webhooks";
/** Jobs whose final attempt failed. Kept for administrators to inspect and requeue (Admin → System). */
export const DEAD_LETTER_QUEUE = "dead-letter";
/** Domain events published by the outbox relay. Uses BullMQ's default key prefix ("bull") for compatibility. */
export const EVENTS_QUEUE = "events";

export type WorkerQueueName = typeof AGENT_TASK_QUEUE | typeof AUTH_EMAIL_QUEUE | typeof MODULE_JOBS_QUEUE | typeof SCHEDULES_QUEUE | typeof WEBHOOKS_QUEUE | typeof DEAD_LETTER_QUEUE | typeof EVENTS_QUEUE;

/** Every queue the worker consumes, with its Redis key prefix. `requeueable` queues accept dead-lettered jobs back. */
export const WORKER_QUEUES: { name: WorkerQueueName; prefix: "app" | "bull"; requeueable: boolean }[] = [
  // AI tasks mark themselves FAILED on the last attempt; they are re-run from the task (a new execution), not requeued.
  { name: AGENT_TASK_QUEUE, prefix: "app", requeueable: false },
  { name: MODULE_JOBS_QUEUE, prefix: "app", requeueable: true },
  { name: SCHEDULES_QUEUE, prefix: "app", requeueable: true },
  { name: WEBHOOKS_QUEUE, prefix: "app", requeueable: true },
  { name: EVENTS_QUEUE, prefix: "bull", requeueable: true },
  // Job data is an email address: failed jobs expire after 24 h and are never copied to the dead-letter queue.
  { name: AUTH_EMAIL_QUEUE, prefix: "app", requeueable: false },
  { name: DEAD_LETTER_QUEUE, prefix: "app", requeueable: false },
];

/** Key prefix of a queue ("bull" is BullMQ's default, used by the events queue since the first release). */
export const prefixFor = (name: string) => (name === EVENTS_QUEUE ? "bull" : queuePrefix());

/**
 * Whether background execution is configured: production needs REDIS_URL (and a running worker service); development
 * and tests assume the local Redis from docker-compose.yml. Without it the web app keeps working: rate limits use
 * Postgres and work that needs the worker is reported as "worker not configured".
 */
export const workerConfigured = () => !!process.env.REDIS_URL?.trim() || process.env.NODE_ENV !== "production";

/** Retry policy per queue: exponential backoff, bounded retention (failed jobs are also persisted in worker_job_runs). */
export const JOB_DEFAULTS = {
  [MODULE_JOBS_QUEUE]: { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: { count: 2_000, age: 24 * 3600 }, removeOnFail: { count: 5_000, age: 7 * 24 * 3600 } },
  [WEBHOOKS_QUEUE]: { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 2_000, age: 24 * 3600 }, removeOnFail: { count: 5_000, age: 7 * 24 * 3600 } },
  [SCHEDULES_QUEUE]: { attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 2_000, age: 7 * 24 * 3600 } },
  [DEAD_LETTER_QUEUE]: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 30 * 24 * 3600 } },
} as const;

/** A module task (src/server/core/module-jobs.ts `tasks`) or one event handler run, queued on MODULE_JOBS_QUEUE. */
export interface ModuleTaskJob {
  /** Task name ("integrations.sync_connection") — or "handler" with `handler` set for a domain-event handler run. */
  task: string;
  data: Record<string, unknown>;
  organizationId?: string | null;
}

/** A dead-lettered job: enough to put it back on its original queue. `data` stays in Redis only (never the database). */
export interface DeadLetterJob {
  queue: string;
  name: string;
  jobId: string;
  data: unknown;
  attempts: number;
  failedReason: string;
  failedAt: string;
}

/** Id of a job's copy in the dead-letter queue (BullMQ custom ids must not contain ":"). */
export const deadLetterJobId = (queue: string, jobId: string) => `${queue}__${jobId}`.replace(/:/g, "_");

/** Redis key of a worker's heartbeat (expires on its own when the worker stops renewing it). */
export const workerHeartbeatKey = (workerId: string) => `${queuePrefix()}:worker:heartbeat:${workerId}`;

export interface DispatchOptions {
  /** Deduplication id (no ":"), e.g. `${deliveryId}_${attempt}`. */
  jobId?: string;
  delayMs?: number;
  organizationId?: string | null;
}

type Dispatcher = (queue: typeof MODULE_JOBS_QUEUE | typeof WEBHOOKS_QUEUE, name: string, data: Record<string, unknown>, opts: DispatchOptions) => Promise<void>;
let dispatcher: Dispatcher | null = null;

/** Called by the worker process at start: module code may then hand work to the queues instead of running it inline. */
export function setJobDispatcher(d: Dispatcher | null) {
  dispatcher = d;
}

/** True inside the worker service (a dispatcher is registered). */
export const queuesAvailable = () => dispatcher !== null;

/**
 * Hand a task to the worker queues. Returns false when no queue is available (web process, Redis down) so the caller
 * runs the work inline instead — the fallback the platform had before the worker queues.
 */
export async function dispatchJob(queue: typeof MODULE_JOBS_QUEUE | typeof WEBHOOKS_QUEUE, name: string, data: Record<string, unknown>, opts: DispatchOptions = {}): Promise<boolean> {
  if (!dispatcher) return false;
  try {
    await dispatcher(queue, name, data, opts);
    return true;
  } catch {
    return false;
  }
}

/** Test hook: close the producer so the next call builds a fresh one (e.g. after simulating an outage). */
export async function resetJobQueuesForTests() {
  await queue?.close().catch(() => undefined);
  await agentQueue?.close().catch(() => undefined);
  queue = null;
  agentQueue = null;
}
