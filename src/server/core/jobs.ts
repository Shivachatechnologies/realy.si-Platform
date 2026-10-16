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

/** Test hook: close the producer so the next call builds a fresh one (e.g. after simulating an outage). */
export async function resetJobQueuesForTests() {
  await queue?.close().catch(() => undefined);
  await agentQueue?.close().catch(() => undefined);
  queue = null;
  agentQueue = null;
}
