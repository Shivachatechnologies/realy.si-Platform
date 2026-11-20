/**
 * Realy worker process (docs/architecture.md §2). Same codebase as the web app, separate entrypoint:
 *   pnpm worker
 * Runs the outbox relay, the auth-email queue (password-reset email, kept off the request path) and the AI task queue;
 * workflow and ingestion processors attach here in later phases.
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
import { AGENT_TASK_QUEUE, AUTH_EMAIL_QUEUE, queuePrefix, type AgentTaskJob, type PasswordResetJob } from "@/server/core/jobs";
import { failStaleTasks, processAgentTask } from "@/server/modules/agents/service";
import { expireApprovals } from "@/server/modules/approvals/service";
import type { OutboxEvent } from "@/server/modules/events/relay";
import { MODULE_JOBS } from "./modules";

const POLL_MS = 500;
let stopping = false;

const MAINTENANCE_MS = 10 * 60 * 1000;

/** Periodic cleanup of expired idempotency keys and auth tokens. */
async function maintenance(log: typeof logger) {
  try {
    const keys = await purgeExpiredIdempotencyKeys();
    const tokens = await purgeExpiredAuthTokens();
    const staleTasks = await failStaleTasks();
    const expiredApprovals = await expireApprovals();
    if (keys || tokens || staleTasks || expiredApprovals) log.info({ idempotencyKeys: keys, authTokens: tokens, staleTasks, expiredApprovals }, "maintenance purge");
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

  const agentTasks = new Worker<AgentTaskJob>(
    AGENT_TASK_QUEUE,
    async (job) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await withSpan("worker.agent_task", { job: job.name }, () => processAgentTask(job.data.taskId, job.id!, { finalAttempt }));
    },
    { connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }), prefix: queuePrefix(), concurrency: 2, lockDuration: 60_000 },
  );
  agentTasks.on("failed", (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, "agent-task attempt failed");
  });

  // Business-module consumers of published domain events (automation engine, AI triggers, notifications...).
  const handlers = MODULE_JOBS.flatMap((m) => m.onEvent);
  const eventConsumer = new Worker<OutboxEvent & { occurredAt: string }>(
    "events",
    async (job) => {
      const event: OutboxEvent = { ...job.data, occurredAt: new Date(job.data.occurredAt) };
      for (const h of handlers) {
        if (h.types !== "*" && !h.types.includes(event.type)) continue;
        await withSpan("worker.event_handler", { handler: h.name, type: event.type }, () => h.handle(event));
      }
    },
    { connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }), concurrency: 4 },
  );
  eventConsumer.on("failed", (job, err) => {
    log.warn({ jobId: job?.id, type: job?.name, err: err.message }, "event handler failed");
    captureException(err, { job: "event-handler", type: job?.name });
  });

  // Business-module periodic jobs (recurring invoices, scheduled posts, workflow schedules, AI schedules...).
  const periodic = MODULE_JOBS.flatMap((m) => m.periodic).map((j) => ({ job: j, next: 0, running: false }));
  const runPeriodic = () => {
    const now = Date.now();
    for (const p of periodic) {
      if (p.running || now < p.next) continue;
      p.running = true;
      p.next = now + p.job.everyMs;
      withSpan("worker.periodic", { job: p.job.name }, () => p.job.run())
        .then((n) => {
          if (n) log.info({ job: p.job.name, count: n }, "periodic job");
        })
        .catch((err) => {
          log.error({ job: p.job.name, err }, "periodic job failed");
          captureException(err, { job: p.job.name });
        })
        .finally(() => {
          p.running = false;
        });
    }
  };

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
    runPeriodic();
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
  await agentTasks.close();
  await eventConsumer.close();
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
