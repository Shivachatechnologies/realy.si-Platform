import "server-only";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { db, Prisma, transaction } from "./db";
import { env } from "./env";
import { conflict, invalid, notFound } from "./errors";
import { SCHEDULES_QUEUE } from "./jobs";
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
import { requireProductionConfirmation } from "@/server/modules/admin/releases";
import { scrubText } from "@/server/modules/admin/errors";

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
  /** Tenant filter (worker_job_runs.organization_id). */
  org: z.string().uuid().optional(),
  /** Job name contains (e.g. "integrations.sync"). */
  job: z.string().trim().max(120).optional(),
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
export async function jobsOverview(ctx: RequestContext, opts: { withQueues?: boolean } = {}) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  const since = new Date(Date.now() - 86_400_000);
  const [worker, queues, byStatus, dead, heartbeats] = await Promise.all([
    workerHealth(),
    // Callers that read queueStates() themselves skip this second round of Redis calls.
    opts.withQueues === false ? Promise.resolve([] as QueueDepth[]) : queueDepths(),
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
    where: { ...(f.status ? { status: f.status } : {}), ...(f.queue ? { queue: f.queue } : {}), ...(f.org ? { organizationId: f.org } : {}), ...(f.job ? { jobName: { contains: f.job, mode: "insensitive" as const } } : {}) },
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

// ───────────────────────────── Jobs v2 (stream E): per-queue control, live job inspection, schedulers ─────────────────────────────
//
// Every call below talks to Redis on demand only (an admin opened a page or pressed a button); nothing polls.
// Destructive operations (pause, cancel, retry-all, run-now) need platform.controls.manage (MFA-gated), a reason and
// a typed confirmation, which in production must start with "PRODUCTION " (releases.ts requireProductionConfirmation).

const queueName = z.string().refine((n) => WORKER_QUEUES.some((q) => q.name === n), "Unknown queue");
const jobIdSchema = z.string().regex(/^[\w:.@-]{1,200}$/);
export const LIVE_JOB_STATES = ["waiting", "active", "delayed", "failed", "completed", "prioritized", "waiting-children"] as const;
type LiveState = (typeof LIVE_JOB_STATES)[number];

function assertManageableQueue(name: string) {
  if (!workerConfigured()) throw invalid("The worker service is not configured (REDIS_URL)", { reason: "worker_not_configured" });
  if (!WORKER_QUEUES.some((q) => q.name === name)) throw notFound("Queue");
}

const unavailable = () => invalid("The job queue is unavailable; retry shortly", { reason: "queue_unavailable" });

/** Queue depths plus the global paused flag of each queue (BullMQ queue.pause/resume). */
export async function queueStates(ctx: RequestContext) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  const depths = await queueDepths();
  return Promise.all(
    depths.map(async (d) => {
      if (!d.available) return { ...d, paused: null as boolean | null };
      const paused = await withTimeout(queue(d.name).isPaused()).catch(() => null);
      return { ...d, paused };
    }),
  );
}

export const queueControlInput = z.object({ reason: reasonSchema, confirm: z.string().max(200).optional() });

/** Pause or resume one queue for every worker (jobs keep waiting; nothing is lost). Audited. */
export async function setQueuePaused(ctx: RequestContext, name: string, paused: boolean, raw: z.input<typeof queueControlInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const input = queueControlInput.parse(raw);
  queueName.parse(name);
  assertManageableQueue(name);
  if (name === DEAD_LETTER_QUEUE) throw conflict("The dead-letter queue has no consumer to pause", { reason: "queue_not_pausable" });
  if (paused) requireProductionConfirmation(input.confirm, `pause ${name}`);
  await withTimeout(paused ? queue(name).pause() : queue(name).resume()).catch(() => {
    throw unavailable();
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: paused ? "platform.queue.paused" : "platform.queue.resumed", resourceType: "worker_queue", resourceId: name, newValue: { paused }, reason: input.reason }));
  return { queue: name, paused };
}

export const liveJobsInput = z.object({ state: z.enum(LIVE_JOB_STATES).default("waiting"), start: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(50).default(25) });

/** Shape of job data without values (key → type), one level deep. Job data can hold personal data. */
export function dataShape(data: unknown, depth = 0): unknown {
  if (data === null) return "null";
  if (Array.isArray(data)) return `array(${data.length})`;
  if (typeof data !== "object") return typeof data;
  if (depth >= 1) return "object";
  return Object.fromEntries(Object.keys(data as Record<string, unknown>).slice(0, 40).map((k) => [k, dataShape((data as Record<string, unknown>)[k], depth + 1)]));
}

interface LiveJob {
  id: string;
  name: string;
  state: string;
  attemptsMade: number;
  attempts: number;
  timestamp: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  failedReason: string | null;
  organizationId: string | null;
}

function toLive(j: Job, state: string): LiveJob {
  const d = j.data as { organizationId?: unknown; data?: { event?: { organizationId?: unknown } } } | null;
  const org = d?.organizationId ?? d?.data?.event?.organizationId;
  return {
    id: String(j.id),
    name: j.name,
    state,
    attemptsMade: j.attemptsMade,
    attempts: j.opts.attempts ?? 1,
    timestamp: j.timestamp ?? null,
    processedOn: j.processedOn ?? null,
    finishedOn: j.finishedOn ?? null,
    delay: j.opts.delay ?? 0,
    failedReason: j.failedReason ? scrubText(j.failedReason, 300) : null,
    organizationId: typeof org === "string" ? org : null,
  };
}

/** Live jobs of one queue and state (Redis offset paging; payloads are never returned). */
export async function listQueueJobs(ctx: RequestContext, name: string, raw: z.input<typeof liveJobsInput> = {}) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  queueName.parse(name);
  assertManageableQueue(name);
  const f = liveJobsInput.parse(raw);
  const jobs = await withTimeout(queue(name).getJobs([f.state as LiveState], f.start, f.start + f.limit)).catch(() => {
    throw unavailable();
  });
  const page = jobs.filter(Boolean).slice(0, f.limit);
  return { queue: name, state: f.state, start: f.start, jobs: page.map((j) => toLive(j, f.state)), nextStart: jobs.length > f.limit ? f.start + f.limit : null };
}

/** One live job: state, attempts, timings, scrubbed failure and stack (no payload values, only their shape). */
export async function inspectJob(ctx: RequestContext, name: string, jobId: string) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  queueName.parse(name);
  if (!jobIdSchema.safeParse(jobId).success) throw notFound("Job");
  assertManageableQueue(name);
  const job = await withTimeout(queue(name).getJob(jobId)).catch(() => {
    throw unavailable();
  });
  if (!job) throw notFound("Job");
  const state = await withTimeout(job.getState()).catch(() => "unknown");
  const run = await db().workerJobRun.findUnique({ where: { queue_jobId: { queue: name, jobId } }, select: { id: true, status: true } });
  return {
    ...toLive(job, String(state)),
    stacktrace: (job.stacktrace ?? []).slice(-3).map((s) => scrubText(s, 2_000)),
    dataShape: name === "auth-email" ? "withheld" : dataShape(job.data),
    opts: { attempts: job.opts.attempts ?? 1, delay: job.opts.delay ?? 0, priority: job.opts.priority ?? 0, backoff: job.opts.backoff ?? null },
    run,
    retryable: state === "failed",
    cancellable: state === "waiting" || state === "delayed" || state === "prioritized",
  };
}

export const jobControlInput = z.object({ reason: reasonSchema, confirm: z.string().max(200).optional() });

/** Retry a FAILED live job (BullMQ retry: back to waiting with its attempts reset). */
export async function retryLiveJob(ctx: RequestContext, name: string, jobId: string, raw: z.input<typeof jobControlInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const input = jobControlInput.parse(raw);
  queueName.parse(name);
  if (!jobIdSchema.safeParse(jobId).success) throw notFound("Job");
  assertManageableQueue(name);
  if (name === DEAD_LETTER_QUEUE) throw conflict("Requeue dead-lettered jobs from their run instead", { reason: "use_requeue" });
  const job = await withTimeout(queue(name).getJob(jobId)).catch(() => {
    throw unavailable();
  });
  if (!job) throw notFound("Job");
  const state = await withTimeout(job.getState()).catch(() => "unknown");
  if (state !== "failed") throw conflict("Only failed jobs can be retried", { reason: "job_not_failed", state });
  await withTimeout(job.retry("failed")).catch(() => {
    throw unavailable();
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.job.retried", resourceType: "worker_job", resourceId: `${name}/${jobId}`, newValue: { queue: name, job: job.name }, reason: input.reason }));
  return { retried: true };
}

/** Cancel (remove) a waiting or delayed job. Running jobs cannot be cancelled (BullMQ cannot stop a running processor). */
export async function cancelLiveJob(ctx: RequestContext, name: string, jobId: string, raw: z.input<typeof jobControlInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const input = jobControlInput.parse(raw);
  queueName.parse(name);
  if (!jobIdSchema.safeParse(jobId).success) throw notFound("Job");
  assertManageableQueue(name);
  requireProductionConfirmation(input.confirm, `cancel ${jobId}`);
  const job = await withTimeout(queue(name).getJob(jobId)).catch(() => {
    throw unavailable();
  });
  if (!job) throw notFound("Job");
  const state = await withTimeout(job.getState()).catch(() => "unknown");
  if (state !== "waiting" && state !== "delayed" && state !== "prioritized") throw conflict("Only waiting or delayed jobs can be cancelled", { reason: "job_not_cancellable", state });
  await withTimeout(job.remove()).catch(() => {
    throw unavailable();
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.job.cancelled", resourceType: "worker_job", resourceId: `${name}/${jobId}`, oldValue: { state }, newValue: { queue: name, job: job.name }, reason: input.reason }));
  return { cancelled: true };
}

/** Retry every failed job of one queue (bounded: BullMQ retries in batches of 1000). */
export async function retryAllFailed(ctx: RequestContext, name: string, raw: z.input<typeof jobControlInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const input = jobControlInput.parse(raw);
  queueName.parse(name);
  assertManageableQueue(name);
  if (name === DEAD_LETTER_QUEUE || name === "auth-email") throw conflict("Jobs of this queue cannot be retried in bulk", { reason: "queue_not_retryable" });
  requireProductionConfirmation(input.confirm, `retry ${name}`);
  const before = await withTimeout(queue(name).getJobCounts("failed")).catch(() => {
    throw unavailable();
  });
  await withTimeout(queue(name).retryJobs({ state: "failed", count: 1000 }), 10_000).catch(() => {
    throw unavailable();
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.queue.retried_failed", resourceType: "worker_queue", resourceId: name, newValue: { failedBefore: before.failed ?? 0 }, reason: input.reason }));
  return { queue: name, retried: before.failed ?? 0 };
}

/** Recurring jobs registered by the worker (BullMQ job schedulers on the schedules queue) with their last recorded run. */
export async function listSchedulers(ctx: RequestContext) {
  await requireAnyPlatform(ctx, JOB_MONITOR_PERMS);
  if (!workerConfigured()) return { available: false as const, schedulers: [] };
  const raw = await withTimeout(queue(SCHEDULES_QUEUE).getJobSchedulers(0, 499, true)).catch(() => null);
  if (!raw) return { available: false as const, schedulers: [] };
  const names = raw.map((s) => s.key ?? s.name).filter(Boolean) as string[];
  const runs = names.length
    ? await db().$queryRaw<{ job_name: string; status: string; updated_at: Date; duration_ms: number | null; last_error: string | null }[]>(Prisma.sql`
        SELECT DISTINCT ON (job_name) job_name, status::text AS status, updated_at, duration_ms, last_error
        FROM worker_job_runs WHERE queue = ${SCHEDULES_QUEUE} AND job_name IN (${Prisma.join(names)}) ORDER BY job_name, updated_at DESC`)
    : [];
  return {
    available: true as const,
    schedulers: raw
      .map((s) => {
        const name = (s.key ?? s.name) as string;
        const r = runs.find((x) => x.job_name === name);
        return { name, everyMs: s.every ? Number(s.every) : null, pattern: s.pattern ?? null, nextRunAt: s.next ? new Date(s.next) : null, iterations: s.iterationCount ?? null, lastRun: r ? { status: r.status, at: r.updated_at, durationMs: r.duration_ms, error: r.last_error ? scrubText(r.last_error, 200) : null } : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Run one recurring job now (an extra job on the schedules queue; the regular schedule is unchanged). */
export async function runSchedulerNow(ctx: RequestContext, name: string, raw: z.input<typeof jobControlInput>) {
  await requirePlatform(ctx, JOB_MANAGE_PERM);
  const input = jobControlInput.parse(raw);
  if (!/^[\w.:-]{1,120}$/.test(name)) throw notFound("Scheduler");
  assertManageableQueue(SCHEDULES_QUEUE);
  requireProductionConfirmation(input.confirm, `run ${name}`);
  const list = await withTimeout(queue(SCHEDULES_QUEUE).getJobSchedulers(0, 499, true)).catch(() => {
    throw unavailable();
  });
  if (!list.some((s) => (s.key ?? s.name) === name)) throw notFound("Scheduler");
  const jobId = `manual__${name}__${Date.now()}`.replace(/:/g, "_");
  await withTimeout(queue(SCHEDULES_QUEUE).add(name, {}, { ...JOB_DEFAULTS[SCHEDULES_QUEUE], jobId })).catch(() => {
    throw unavailable();
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.scheduler.run_now", resourceType: "worker_scheduler", resourceId: name, newValue: { jobId }, reason: input.reason }));
  return { name, jobId };
}
