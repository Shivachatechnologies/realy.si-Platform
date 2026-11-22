import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { db, transaction, type Prisma } from "./db";
import { env } from "./env";
import { conflict, invalid, notFound } from "./errors";
import { pageInput, prismaPage, toPage } from "./pagination";
import type { RequestContext } from "./context";
import {
  DEAD_LETTER_QUEUE,
  deadLetterJobId,
  JOB_DEFAULTS,
  prefixFor,
  WORKER_QUEUES,
  workerConfigured,
  type DeadLetterJob,
  type WorkerQueueName,
} from "./jobs";
import { writeAudit } from "@/server/modules/audit/service";
import { reasonSchema, requireAnyPlatform, requirePlatform } from "@/server/modules/admin/access";

/**
 * Platform administration of the worker service: queue depths, worker heartbeats, persisted job runs (status + execution
 * log) and the dead-letter queue with requeue/discard. Reading needs a platform monitoring permission; requeue and
 * discard need platform.controls.manage and are audited with a reason. Job payloads are never returned.
 */

export const JOB_MONITOR_PERMS = ["platform.security.read", "platform.organizations.read", "platform.controls.manage"];
export const JOB_MANAGE_PERM = "platform.controls.manage";

/** A worker is alive when its heartbeat is newer than this (it beats every WORKER_HEARTBEAT_MS, default 60 s). */
export const WORKER_STALE_MS = 3 * 60_000;

export const WORKER_JOB_STATUSES = ["ACTIVE", "RETRYING", "SUCCEEDED", "FAILED", "DEAD", "REQUEUED"] as const;

export interface WorkerHealth {
  /** REDIS_URL is set (production) or the local default applies (development). */
  configured: boolean;
  /** "ok": at least one live heartbeat; "stale": heartbeats exist but none is recent; "missing": never seen; "not_configured". */
  state: "ok" | "stale" | "missing" | "not_configured";
  alive: number;
  lastSeenAt: Date | null;
}

/** Worker liveness from the heartbeat rows (no Redis needed, so the web app can always answer). */
export async function workerHealth(): Promise<WorkerHealth> {
  const configured = workerConfigured();
  const rows = await db()
    .platformHeartbeat.findMany({ where: { kind: "worker" }, orderBy: { lastSeenAt: "desc" }, take: 50, select: { lastSeenAt: true } })
    .catch(() => [] as { lastSeenAt: Date }[]);
  const alive = rows.filter((r) => Date.now() - r.lastSeenAt.getTime() < WORKER_STALE_MS).length;
  const lastSeenAt = rows[0]?.lastSeenAt ?? null;
  const state = !configured ? "not_configured" : alive > 0 ? "ok" : rows.length ? "stale" : "missing";
  return { configured, state, alive, lastSeenAt };
}

let adminQueues: Map<string, Queue> | null = null;
function queue(name: string): Queue {
  adminQueues ??= new Map();
  let q = adminQueues.get(name);
  if (!q) {
    // Fail fast while Redis is down: admin pages must never hang on it.
    q = new Queue(name, { connection: new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2000 }), prefix: prefixFor(name) });
    q.on("error", () => undefined);
    adminQueues.set(name, q);
  }
  return q;
}

const withTimeout = <T>(p: Promise<T>, ms = 2500) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export interface QueueDepth {
  name: WorkerQueueName;
  available: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

/** Job counts of every worker queue; `available: false` when Redis is unreachable or not configured. */
export async function queueDepths(): Promise<QueueDepth[]> {
  return Promise.all(
    WORKER_QUEUES.map(async ({ name }) => {
      const empty = { name, available: false, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
      if (!workerConfigured()) return empty;
      try {
        const c = await withTimeout(queue(name).getJobCounts("waiting", "active", "delayed", "failed", "completed"));
        return { name, available: true, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
      } catch {
        return empty;
      }
    }),
  );
}

export const jobRunFilters = pageInput.extend({
  status: z.enum(WORKER_JOB_STATUSES).optional(),
  queue: z.string().max(40).optional(),
});

const runSelect = {
  id: true,
  queue: true,
  jobName: true,
  jobId: true,
  organizationId: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  lastError: true,
  result: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  workerId: true,
  deadLetteredAt: true,
  requeuedAt: true,
  requeueCount: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkerJobRunSelect;

/** Overview for Admin → System: worker health, queue depths and the last 24 h of job outcomes. */
export async function jobsOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  const since = new Date(Date.now() - 86_400_000);
  const [worker, queues, byStatus, dead, heartbeats] = await Promise.all([
    workerHealth(),
    queueDepths(),
    db().workerJobRun.groupBy({ by: ["status"], where: { updatedAt: { gte: since } }, _count: { _all: true } }),
    db().workerJobRun.count({ where: { status: "DEAD" } }),
    db().platformHeartbeat.findMany({ where: { kind: "worker" }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
  ]);
  const last24h = Object.fromEntries(WORKER_JOB_STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<(typeof WORKER_JOB_STATUSES)[number], number>;
  return {
    worker,
    queues,
    last24h,
    deadLetters: dead,
    workers: heartbeats.map((h) => ({ id: h.id, hostname: h.hostname, pid: h.pid, startedAt: h.startedAt, lastSeenAt: h.lastSeenAt, alive: Date.now() - h.lastSeenAt.getTime() < WORKER_STALE_MS, info: h.info })),
  };
}

/** Persisted job runs, newest first (filter by status, e.g. DEAD for the dead-letter list). */
export async function listJobRuns(ctx: RequestContext, raw: z.input<typeof jobRunFilters>) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  const f = jobRunFilters.parse(raw);
  const rows = await db().workerJobRun.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(f.queue ? { queue: f.queue } : {}) },
    orderBy: { id: "desc" },
    select: runSelect,
    ...prismaPage(f),
  });
  return toPage(rows, f);
}

const uuid = z.string().uuid();

/** One run with its execution log. */
export async function getJobRun(ctx: RequestContext, runId: string) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  if (!uuid.safeParse(runId).success) throw notFound("Job run");
  const run = await db().workerJobRun.findUnique({ where: { id: runId }, select: { ...runSelect, logs: true } });
  if (!run) throw notFound("Job run");
  return { ...run, requeueable: WORKER_QUEUES.find((q) => q.name === run.queue)?.requeueable === true && run.status === "DEAD" };
}

export const jobActionInput = z.object({ reason: reasonSchema });

async function loadDeadRun(runId: string) {
  if (!uuid.safeParse(runId).success) throw notFound("Job run");
  const run = await db().workerJobRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound("Job run");
  if (run.status !== "DEAD") throw conflict("Only dead-lettered jobs can be requeued or discarded", { reason: "job_not_dead", status: run.status });
  if (!workerConfigured()) throw invalid("The worker service is not configured (REDIS_URL)", { reason: "worker_not_configured" });
  return run;
}

const appendLog = (logs: Prisma.JsonValue, message: string) =>
  [...(Array.isArray(logs) ? logs : []), { at: new Date().toISOString(), level: "info", message }].slice(-40) as Prisma.InputJsonValue;

/** Send a dead-lettered job back to its original queue as a fresh job (full retry budget). */
export async function requeueJobRun(ctx: RequestContext, runId: string, raw: z.input<typeof jobActionInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const { reason } = jobActionInput.parse(raw);
  const run = await loadDeadRun(runId);
  const target = WORKER_QUEUES.find((q) => q.name === run.queue);
  if (!target?.requeueable) throw conflict("Jobs of this queue cannot be requeued", { reason: "queue_not_requeueable" });
  const dlq = queue(DEAD_LETTER_QUEUE);
  const copy = await withTimeout(dlq.getJob(deadLetterJobId(run.queue, run.jobId))).catch(() => {
    throw invalid("The job queue is unavailable; retry shortly", { reason: "queue_unavailable" });
  });
  if (!copy) throw conflict("The dead-letter copy has expired; the job can no longer be requeued", { reason: "dead_letter_expired" });
  const data = (copy.data as DeadLetterJob).data;
  const newJobId = `${run.jobId}-rq${run.requeueCount + 1}`.replace(/:/g, "_");
  const defaults = run.queue in JOB_DEFAULTS ? JOB_DEFAULTS[run.queue as keyof typeof JOB_DEFAULTS] : { attempts: 5, backoff: { type: "exponential", delay: 5_000 } };
  await withTimeout(queue(run.queue).add((copy.data as DeadLetterJob).name, data, { ...defaults, jobId: newJobId }));
  await copy.remove().catch(() => undefined);
  await transaction(async (tx) => {
    await tx.workerJobRun.update({
      where: { id: run.id },
      data: { status: "REQUEUED", requeuedAt: new Date(), requeuedById: ctx.actor.id ?? null, requeueCount: { increment: 1 }, logs: appendLog(run.logs, `Requeued by an administrator as job ${newJobId}`) },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: run.organizationId, action: "platform.job.requeued", resourceType: "worker_job_run", resourceId: run.id, oldValue: { status: run.status, queue: run.queue, job: run.jobName }, newValue: { jobId: newJobId }, reason });
  });
  return { requeued: true, queue: run.queue, jobId: newJobId };
}

/** Drop a dead-lettered job for good (its copy is removed from the dead-letter queue; the run stays as FAILED). */
export async function discardJobRun(ctx: RequestContext, runId: string, raw: z.input<typeof jobActionInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const { reason } = jobActionInput.parse(raw);
  const run = await loadDeadRun(runId);
  const copy = await withTimeout(queue(DEAD_LETTER_QUEUE).getJob(deadLetterJobId(run.queue, run.jobId))).catch(() => null);
  await copy?.remove().catch(() => undefined);
  await transaction(async (tx) => {
    await tx.workerJobRun.update({ where: { id: run.id }, data: { status: "FAILED", logs: appendLog(run.logs, "Discarded by an administrator") } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: run.organizationId, action: "platform.job.discarded", resourceType: "worker_job_run", resourceId: run.id, oldValue: { status: run.status, queue: run.queue, job: run.jobName }, reason });
  });
  return { discarded: true };
}
