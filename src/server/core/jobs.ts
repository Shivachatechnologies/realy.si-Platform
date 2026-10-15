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

/** Enqueue a password-reset job. Job data (an email address) is deleted on completion and 24 h after a failure. */
export async function enqueuePasswordReset(job: PasswordResetJob): Promise<void> {
  const add = authEmailQueue().add("password_reset", job, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: { age: 24 * 60 * 60 },
  });
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

/** Test hook: close the producer so the next call builds a fresh one (e.g. after simulating an outage). */
export async function resetJobQueuesForTests() {
  await queue?.close().catch(() => undefined);
  queue = null;
}
