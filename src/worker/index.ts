/**
 * Realy worker process (docs/architecture.md §2). Same codebase as the web app, separate entrypoint:
 *   pnpm worker
 * Runs the outbox relay and the auth-email queue (password-reset email, kept off the request path);
 * workflow, agent and ingestion processors attach here in later phases.
 */
import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { relayBatch } from "@/server/modules/events/relay";
import { db } from "@/server/core/db";
import { initObservability } from "@/server/core/observability";
import { captureException, withSpan } from "@/server/core/telemetry";
import { purgeExpiredIdempotencyKeys } from "@/server/core/idempotency";
import { processPasswordResetRequest, purgeExpiredAuthTokens } from "@/server/modules/auth/recovery";
import { AUTH_EMAIL_QUEUE, queuePrefix, type PasswordResetJob } from "@/server/core/jobs";

const POLL_MS = 500;
let stopping = false;

const MAINTENANCE_MS = 10 * 60 * 1000;

/** Periodic cleanup of expired idempotency keys and auth tokens. */
async function maintenance(log: typeof logger) {
  try {
    const keys = await purgeExpiredIdempotencyKeys();
    const tokens = await purgeExpiredAuthTokens();
    if (keys || tokens) log.info({ idempotencyKeys: keys, authTokens: tokens }, "maintenance purge");
  } catch (err) {
    log.error({ err }, "maintenance failed");
    captureException(err, { job: "maintenance" });
  }
}

async function main() {
  await initObservability("realy-worker");
  const connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("events", { connection });
  const log = logger.child({ component: "outbox-relay" });
  log.info("worker started");

  const authEmail = new Worker<PasswordResetJob>(
    AUTH_EMAIL_QUEUE,
    // Return nothing: BullMQ records return values in Redis, and "sent" vs "no_account" would reveal accounts.
    async (job) => {
      await withSpan("worker.auth_email", { job: job.name }, () => processPasswordResetRequest(job.data));
    },
    { connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }), prefix: queuePrefix(), concurrency: 5 },
  );
  // Never log job data (it contains an email address).
  authEmail.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "auth-email job failed");
    captureException(err, { job: "auth-email" });
  });

  const publish = async (events: Awaited<Parameters<Parameters<typeof relayBatch>[0]>[0]>) => {
    // Job id = event id → BullMQ dedupes re-published events.
    await queue.addBulk(
      events.map((e) => ({
        name: e.type,
        data: { ...e, occurredAt: e.occurredAt.toISOString() },
        opts: { jobId: e.id, removeOnComplete: 10_000, removeOnFail: 50_000, attempts: 10, backoff: { type: "exponential", delay: 1000 } },
      })),
    );
  };

  let nextMaintenance = 0;
  while (!stopping) {
    if (Date.now() >= nextMaintenance) {
      nextMaintenance = Date.now() + MAINTENANCE_MS;
      await maintenance(log);
    }
    try {
      const n = await withSpan("worker.outbox_relay", {}, () => relayBatch(publish));
      if (n > 0) log.info({ published: n }, "relayed events");
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      log.error({ err }, "relay batch failed");
      captureException(err, { job: "outbox-relay" });
      await new Promise((r) => setTimeout(r, POLL_MS * 4));
    }
  }
  await authEmail.close();
  await queue.close();
  await connection.quit();
  await db().$disconnect();
  log.info("worker stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
  });
}

main().catch((err) => {
  logger.fatal({ err }, "worker crashed");
  process.exit(1);
});
