/**
 * Realy worker service (docs/architecture.md §2, docs/deployment.md "Worker service"). Same codebase as the web app,
 * separate long-running process:
 *   pnpm worker            (= tsx src/worker/index.ts; in the Docker image: node_modules/.bin/tsx src/worker/index.ts)
 *
 * Queues (BullMQ on Redis, all retried with exponential backoff; final failures are persisted in worker_job_runs and
 * copied to the "dead-letter" queue, from where platform administrators requeue them — /api/v1/admin/jobs):
 *   agent-tasks   AI task executions (enqueued by the web app)
 *   auth-email    password-reset email (kept off the request path)
 *   events        domain events published by the outbox relay; fanned out to one module-jobs job per handler
 *   module-jobs   event handler runs and module tasks (integration syncs, connection health checks...)
 *   schedules     recurring module work via BullMQ job schedulers (one run per tick across all replicas)
 *   webhooks      outbound webhook deliveries
 * Plus the outbox relay loop, platform-control pauses and a heartbeat (Postgres row + Redis key).
 *
 * Environment: DATABASE_URL, REDIS_URL, ENCRYPTION_KEY (+ provider keys); concurrency and roles in ./config.ts.
 * SIGTERM/SIGINT: stop taking jobs, wait up to WORKER_SHUTDOWN_TIMEOUT_MS for running ones, then exit.
 */
// First: lets modules that import "server-only" load outside Next (see ./preload.ts).
import "./preload";
import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { hostname } from "node:os";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { relayBatch, type OutboxEvent } from "@/server/modules/events/relay";
import { db } from "@/server/core/db";
import { initObservability, markProcessApp } from "@/server/core/observability";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { ensurePlatformSecretsFresh } from "@/server/core/platform-secrets";
import { captureException, withSpan } from "@/server/core/telemetry";
import { purgeExpiredIdempotencyKeys } from "@/server/core/idempotency";
import { processPasswordResetRequest, purgeExpiredAuthTokens } from "@/server/modules/auth/recovery";
import {
  AGENT_TASK_QUEUE,
  AUTH_EMAIL_QUEUE,
  DEAD_LETTER_QUEUE,
  deadLetterJobId,
  EVENTS_QUEUE,
  JOB_DEFAULTS,
  MODULE_JOBS_QUEUE,
  queuePrefix,
  SCHEDULES_QUEUE,
  setJobDispatcher,
  WEBHOOKS_QUEUE,
  workerConfigured,
  workerHeartbeatKey,
  type AgentTaskJob,
  type DeadLetterJob,
  type ModuleTaskJob,
  type PasswordResetJob,
} from "@/server/core/jobs";
import type { EventHandler, ModuleTask, PeriodicJob } from "@/server/core/module-jobs";
import { failStaleTasks, processAgentTask } from "@/server/modules/agents/service";
import { expireApprovals } from "@/server/modules/approvals/service";
import { getControls } from "@/server/core/platform-controls";
import { MODULE_JOBS } from "./modules";
import { workerConfig, type WorkerRole } from "./config";
import { errorMessage, tracked, WORKER_ID, type DeadLetterSink } from "./tracking";
import { registerSchedulers, scheduleProcessor } from "./schedules";
import { OPS_JOBS } from "./ops-jobs";

const POLL_MS = 500;
let stopping = false;
const log = logger.child({ component: "worker" });

/** Periodic cleanup: expired idempotency keys and auth tokens, stale AI tasks, expired approvals, old job runs. */
async function maintenance(): Promise<number> {
  const keys = await purgeExpiredIdempotencyKeys();
  const tokens = await purgeExpiredAuthTokens();
  // While AI execution or background jobs are paused, queued tasks wait on purpose: do not fail them as stale.
  const controls = await getControls();
  const staleTasks = controls.aiExecutionPaused || controls.backgroundJobsPaused ? 0 : await failStaleTasks();
  const expiredApprovals = await expireApprovals();
  const day = 86_400_000;
  const runs = await db().workerJobRun.deleteMany({
    where: {
      OR: [
        { status: "SUCCEEDED", updatedAt: { lt: new Date(Date.now() - 7 * day) } },
        // Recurring ticks are frequent: keep their successful runs for two days.
        { status: "SUCCEEDED", queue: SCHEDULES_QUEUE, updatedAt: { lt: new Date(Date.now() - 2 * day) } },
        { status: { in: ["FAILED", "REQUEUED", "RETRYING"] }, updatedAt: { lt: new Date(Date.now() - 30 * day) } },
        // Dead-letter copies expire from Redis after 30 days; their rows go a little later.
        { status: "DEAD", updatedAt: { lt: new Date(Date.now() - 35 * day) } },
      ],
    },
  });
  const total = keys + tokens + staleTasks + expiredApprovals + runs.count;
  if (total) log.info({ idempotencyKeys: keys, authTokens: tokens, staleTasks, expiredApprovals, jobRuns: runs.count }, "maintenance purge");
  return total;
}

/** Platform-level recurring jobs (module jobs come from src/worker/modules.ts). */
const PLATFORM_JOBS: PeriodicJob[] = [{ name: "platform.maintenance", everyMs: 10 * 60_000, run: maintenance }, ...OPS_JOBS];

const orgOf = (data: unknown) => {
  const d = data as { organizationId?: unknown; data?: { event?: { organizationId?: unknown } } } | null;
  const v = d?.organizationId ?? d?.data?.event?.organizationId;
  return typeof v === "string" ? v : null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  markProcessApp("worker");
  // Platform keys set in the Control Center (docs/platform-keys.md): overlay before anything reads env(), then keep
  // them fresh (~30 s) for long-running jobs. Never throws; falls back to the host env.
  await ensurePlatformSecretsFresh();
  setInterval(() => void ensurePlatformSecretsFresh(), 30_000).unref();
  await initObservability("realy-worker");
  // Stream E: error grouping of failed jobs and the warn+ log store, then this boot's release row.
  await (await import("@/server/core/request-hooks")).installHooks("worker");
  void (await import("@/server/modules/admin/releases")).recordRelease("worker");
  if (!workerConfigured()) {
    // Production without REDIS_URL: the web app falls back (Postgres rate limits) and reports "worker not configured".
    log.fatal("REDIS_URL is not set: the worker service needs Redis (docs/deployment.md). Exiting.");
    process.exit(1);
  }
  const cfg = workerConfig();
  const has = (r: WorkerRole) => cfg.roles.has(r);
  const conn = () => new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  const redis = conn();
  const prefix = queuePrefix();
  log.info({ roles: [...cfg.roles], concurrency: cfg.concurrency, workerId: WORKER_ID }, "worker starting");

  // Producers.
  const eventsQueue = new Queue(EVENTS_QUEUE, { connection: redis });
  const moduleQueue = new Queue<ModuleTaskJob>(MODULE_JOBS_QUEUE, { connection: redis, prefix });
  const webhookQueue = new Queue<ModuleTaskJob>(WEBHOOKS_QUEUE, { connection: redis, prefix });
  const schedulesQueue = new Queue(SCHEDULES_QUEUE, { connection: redis, prefix });
  const deadLetterQueue = new Queue<DeadLetterJob>(DEAD_LETTER_QUEUE, { connection: redis, prefix });
  const producers: Queue[] = [eventsQueue, moduleQueue, webhookQueue, schedulesQueue, deadLetterQueue];
  for (const q of producers) q.on("error", (err) => log.warn({ queue: q.name, err: err.message }, "queue error"));

  const deadLetter =
    (queue: string): DeadLetterSink =>
    async (job, reason) => {
      await deadLetterQueue.add(
        job.name,
        { queue, name: job.name, jobId: String(job.id), data: job.data, attempts: job.attemptsMade + 1, failedReason: reason, failedAt: new Date().toISOString() },
        { ...JOB_DEFAULTS[DEAD_LETTER_QUEUE], jobId: deadLetterJobId(queue, String(job.id)) },
      );
    };

  // Module tasks and event handlers.
  const handlers: EventHandler[] = MODULE_JOBS.flatMap((m) => m.onEvent);
  const handlerByName = new Map(handlers.map((h) => [h.name, h]));
  const tasks: ModuleTask[] = MODULE_JOBS.flatMap((m) => m.tasks ?? []);
  const taskByName = new Map(tasks.map((t) => [t.name, t]));
  const periodic: PeriodicJob[] = [...MODULE_JOBS.flatMap((m) => m.periodic), ...PLATFORM_JOBS];

  // Module code hands work to the queues through dispatchJob (src/server/core/jobs.ts) while this process runs.
  setJobDispatcher(async (queue, name, data, opts) => {
    const task = taskByName.get(name);
    const target = queue === WEBHOOKS_QUEUE ? webhookQueue : moduleQueue;
    await target.add(
      name,
      { task: name, data, organizationId: opts.organizationId ?? null },
      { ...JOB_DEFAULTS[queue], ...(task?.attempts ? { attempts: task.attempts } : {}), ...(opts.jobId ? { jobId: opts.jobId } : {}), ...(opts.delayMs ? { delay: opts.delayMs } : {}) },
    );
  });

  const workers: { name: string; worker: Worker }[] = [];
  const onFailed = (name: string) => (job: Job | undefined, err: Error) => {
    log.warn({ queue: name, jobId: job?.id, job: job?.name, attempt: job?.attemptsMade, err: err.message }, "job attempt failed");
  };

  if (has("email")) {
    const w = new Worker<PasswordResetJob>(
      AUTH_EMAIL_QUEUE,
      // Return nothing: BullMQ records return values in Redis, and "sent" vs "no_account" would reveal accounts.
      tracked({ queue: AUTH_EMAIL_QUEUE, persist: "always", redactErrors: true }, async (job: Job<PasswordResetJob>) => {
        await withSpan("worker.auth_email", { job: job.name }, () => processPasswordResetRequest(job.data));
      }),
      { connection: conn(), prefix, concurrency: cfg.concurrency.authEmail },
    );
    // Never log job data (it contains an email address).
    w.on("failed", (job, err) => {
      log.error({ jobId: job?.id, err: err.message }, "auth-email job failed");
      captureException(err, { job: "auth-email" });
    });
    workers.push({ name: AUTH_EMAIL_QUEUE, worker: w });
  }

  if (has("agents")) {
    const w = new Worker<AgentTaskJob>(
      AGENT_TASK_QUEUE,
      tracked({ queue: AGENT_TASK_QUEUE, persist: "always" }, async (job: Job<AgentTaskJob>) => {
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        await withSpan("worker.agent_task", { job: job.name }, () => processAgentTask(job.data.taskId, job.id!, { finalAttempt }));
      }),
      { connection: conn(), prefix, concurrency: cfg.concurrency.agentTasks, lockDuration: cfg.agentLockMs },
    );
    w.on("failed", onFailed(AGENT_TASK_QUEUE));
    workers.push({ name: AGENT_TASK_QUEUE, worker: w });
  }

  if (has("events")) {
    // Fan-out only: each matching handler becomes its own module-jobs job, retried (and dead-lettered) on its own, so
    // one failing handler never re-runs the others. Job id = event id + handler → duplicates are ignored.
    const w = new Worker<OutboxEvent & { occurredAt: string }>(
      EVENTS_QUEUE,
      async (job) => {
        const event = job.data;
        const matching = handlers.filter((h) => h.types === "*" || h.types.includes(event.type));
        if (!matching.length) return 0;
        await moduleQueue.addBulk(
          matching.map((h) => ({
            name: `handler.${h.name}`,
            data: { task: "handler", data: { handler: h.name, event }, organizationId: event.organizationId },
            opts: { ...JOB_DEFAULTS[MODULE_JOBS_QUEUE], jobId: `${event.id}_${h.name}`.replace(/:/g, "_") },
          })),
        );
        return matching.length;
      },
      { connection: conn(), concurrency: cfg.concurrency.events },
    );
    w.on("failed", (job, err) => {
      log.warn({ jobId: job?.id, type: job?.name, err: err.message }, "event fan-out failed");
      captureException(err, { job: "event-fanout", type: job?.name });
    });
    workers.push({ name: EVENTS_QUEUE, worker: w });
  }

  const runTask = async (job: Job<ModuleTaskJob>): Promise<number> => {
    const { task, data } = job.data;
    if (task === "handler") {
      const h = handlerByName.get(String(data.handler));
      if (!h) return 0; // handler removed since the event was published
      const raw = data.event as OutboxEvent & { occurredAt: string };
      const event: OutboxEvent = { ...raw, occurredAt: new Date(raw.occurredAt) };
      // Platform controls: automations off skips automation handlers (Admin → Platform Controls).
      const controls = await getControls();
      if (!controls.automationsEnabled && h.name.startsWith("automation")) return 0;
      await withSpan("worker.event_handler", { handler: h.name, type: event.type }, () => h.handle(event));
      return 1;
    }
    const t = taskByName.get(task);
    if (!t) throw new Error(`unknown module task ${task}`);
    const n = await withSpan("worker.module_task", { task }, () => t.run(data));
    return typeof n === "number" ? n : 1;
  };

  if (has("modules")) {
    const w = new Worker<ModuleTaskJob>(
      MODULE_JOBS_QUEUE,
      tracked({ queue: MODULE_JOBS_QUEUE, persist: "always", organizationOf: orgOf, deadLetter: deadLetter(MODULE_JOBS_QUEUE) }, runTask),
      { connection: conn(), prefix, concurrency: cfg.concurrency.moduleJobs, lockDuration: 120_000 },
    );
    w.on("failed", (job, err) => {
      onFailed(MODULE_JOBS_QUEUE)(job, err);
      captureException(err, { job: job?.name ?? "module-job" });
    });
    workers.push({ name: MODULE_JOBS_QUEUE, worker: w });
  }

  if (has("webhooks")) {
    const w = new Worker<ModuleTaskJob>(
      WEBHOOKS_QUEUE,
      tracked({ queue: WEBHOOKS_QUEUE, persist: "always", organizationOf: orgOf, deadLetter: deadLetter(WEBHOOKS_QUEUE) }, runTask),
      { connection: conn(), prefix, concurrency: cfg.concurrency.webhooks },
    );
    w.on("failed", onFailed(WEBHOOKS_QUEUE));
    workers.push({ name: WEBHOOKS_QUEUE, worker: w });
  }

  if (has("schedules")) {
    await registerSchedulers(schedulesQueue, periodic);
    const run = scheduleProcessor(periodic, redis);
    const w = new Worker(
      SCHEDULES_QUEUE,
      tracked({ queue: SCHEDULES_QUEUE, persist: "work_or_failure", deadLetter: deadLetter(SCHEDULES_QUEUE) }, (job: Job) => withSpan("worker.periodic", { job: job.name }, () => run(job))),
      { connection: conn(), prefix, concurrency: cfg.concurrency.schedules, lockDuration: 300_000 },
    );
    w.on("failed", (job, err) => {
      log.error({ job: job?.name, err: err.message }, "periodic job failed");
      captureException(err, { job: job?.name ?? "periodic" });
    });
    workers.push({ name: SCHEDULES_QUEUE, worker: w });
  }

  for (const { name, worker } of workers) worker.on("error", (err) => log.warn({ queue: name, err: err.message }, "worker error"));

  // Pausing a BullMQ worker stops it fetching jobs: AI tasks stay queued (execution paused) and published events and
  // module jobs wait in their queues (background jobs paused) while the outbox relay keeps running.
  const paused = { agents: false, background: false };
  const pausable = (names: string[]) => workers.filter((w) => names.includes(w.name)).map((w) => w.worker);
  const applyPauses = async () => {
    const c = await getControls();
    const wantAgents = c.aiExecutionPaused || c.backgroundJobsPaused;
    if (wantAgents !== paused.agents) {
      paused.agents = wantAgents;
      for (const w of pausable([AGENT_TASK_QUEUE])) {
        if (wantAgents) await w.pause(true);
        else w.resume();
      }
      log.warn({ paused: wantAgents }, "agent task execution pause changed");
    }
    if (c.backgroundJobsPaused !== paused.background) {
      paused.background = c.backgroundJobsPaused;
      for (const w of pausable([EVENTS_QUEUE, MODULE_JOBS_QUEUE, WEBHOOKS_QUEUE])) {
        if (paused.background) await w.pause(true);
        else w.resume();
      }
      log.warn({ paused: paused.background }, "background job pause changed");
    }
  };

  // Heartbeat for /api/health/ready and Admin → System & Monitoring: Postgres row + expiring Redis key.
  const startedAt = new Date();
  const heartbeatId = `worker:${hostname()}:${process.pid}`;
  const version = process.env.APP_VERSION ?? process.env.GIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.FLY_IMAGE_REF ?? null;
  // Event-loop lag for Admin → Infrastructure (no Redis involved: written into the Postgres heartbeat row).
  const loopDelay = monitorEventLoopDelay({ resolution: 50 });
  loopDelay.enable();
  const heartbeat = async () => {
    const now = new Date();
    const mem = process.memoryUsage();
    const info = {
      paused,
      // Queues this process does not consume right now because of platform controls (local, no Redis call).
      pausedQueues: workers.filter((w) => (paused.agents && w.name === AGENT_TASK_QUEUE) || (paused.background && [EVENTS_QUEUE, MODULE_JOBS_QUEUE, WEBHOOKS_QUEUE].includes(w.name))).map((w) => w.name),
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, uptimeSeconds: Math.round(process.uptime()), eventLoopLagMs: Math.round((loopDelay.percentile(99) / 1e6) * 10) / 10, node: process.version },
      roles: [...cfg.roles],
      queues: workers.map((w) => w.name),
      concurrency: cfg.concurrency,
      periodicJobs: periodic.length,
      eventHandlers: handlers.length,
      moduleTasks: tasks.length,
      version,
    };
    loopDelay.reset();
    try {
      await db().platformHeartbeat.upsert({
        where: { id: heartbeatId },
        create: { id: heartbeatId, kind: "worker", hostname: hostname(), pid: process.pid, startedAt, lastSeenAt: now, info },
        update: { lastSeenAt: now, info },
      });
    } catch (err) {
      log.warn({ err: errorMessage(err) }, "heartbeat (database) failed");
    }
    await redis.set(workerHeartbeatKey(WORKER_ID), JSON.stringify({ at: now.toISOString(), roles: info.roles }), "PX", cfg.heartbeatMs * 3).catch(() => undefined);
  };

  const relayLog = logger.child({ component: "outbox-relay" });
  const publish = async (events: OutboxEvent[]) => {
    // Job id = event id → BullMQ dedupes re-published events.
    await eventsQueue.addBulk(
      events.map((e) => ({
        name: e.type,
        data: { ...e, occurredAt: e.occurredAt.toISOString() },
        opts: { jobId: e.id, removeOnComplete: 10_000, removeOnFail: 50_000, attempts: 10, backoff: { type: "exponential", delay: 1000 } },
      })),
    );
    await (await import("@/server/modules/voiceos/stream-bus")).publishStreamEvents(redis, events); // G5: live-stream fan-out (B20); never throws
  };

  log.info({ queues: workers.map((w) => w.name), relay: has("relay") }, "worker started");
  let nextHeartbeat = 0;
  while (!stopping) {
    try {
      await applyPauses();
    } catch (err) {
      log.error({ err: errorMessage(err) }, "platform controls check failed");
    }
    if (Date.now() >= nextHeartbeat) {
      nextHeartbeat = Date.now() + cfg.heartbeatMs;
      await heartbeat();
    }
    if (!has("relay")) {
      await sleep(POLL_MS * 4);
      continue;
    }
    try {
      const n = await withSpan("worker.outbox_relay", {}, () => relayBatch(publish));
      if (n > 0) relayLog.info({ published: n }, "relayed events");
      if (n === 0) await sleep(POLL_MS);
    } catch (err) {
      relayLog.error({ err }, "relay batch failed");
      captureException(err, { job: "outbox-relay" });
      await sleep(POLL_MS * 4);
    }
  }

  // Graceful shutdown: stop fetching, let running jobs finish (bounded), then release connections.
  log.info({ timeoutMs: cfg.shutdownTimeoutMs }, "worker stopping; waiting for running jobs");
  setJobDispatcher(null);
  const closing = Promise.all(workers.map((w) => w.worker.close()));
  const timedOut = await Promise.race([closing.then(() => false), sleep(cfg.shutdownTimeoutMs).then(() => true)]);
  if (timedOut) {
    // Jobs still running are released; BullMQ's stalled-job check hands them to another worker.
    log.warn("shutdown timeout reached; closing workers forcefully");
    await Promise.all(workers.map((w) => w.worker.close(true).catch(() => undefined)));
  }
  await Promise.all(producers.map((q) => q.close().catch(() => undefined)));
  await db().platformHeartbeat.delete({ where: { id: heartbeatId } }).catch(() => undefined);
  await redis.del(workerHeartbeatKey(WORKER_ID)).catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await db().$disconnect();
  log.info("worker stopped");
  process.exit(0);
}

let signals = 0;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    signals++;
    if (signals > 1) {
      log.warn({ signal: sig }, "second signal: exiting immediately");
      process.exit(1);
    }
    stopping = true;
  });
}

main().catch((err) => {
  logger.fatal({ err }, "worker crashed");
  process.exit(1);
});
