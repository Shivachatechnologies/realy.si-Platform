import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { db } from "@/server/core/db";
import { env } from "@/server/core/env";
import { WORKER_QUEUES, prefixFor } from "@/server/core/jobs";
import { redis } from "@/server/core/rate-limit";
import type { RequestContext } from "@/server/core/context";
import { emailConfigured } from "@/server/modules/email/service";
import { billingConfigured } from "@/server/modules/billing/stripe-billing";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { requireAnyPlatform } from "./access";

export const MONITOR_PERMS = ["platform.security.read", "platform.organizations.read", "platform.controls.manage"];

export interface Health {
  database: boolean;
  redis: boolean;
  email: boolean;
  ai: boolean;
  stripe: boolean;
}

/** Live checks (database, Redis) and configuration presence (email, AI, Stripe) — booleans only, never secrets. */
export async function platformHealth(): Promise<Health> {
  const [database, redisOk] = await Promise.all([
    db().$queryRaw`SELECT 1`.then(() => true, () => false),
    redis().ping().then((r) => r === "PONG", () => false),
  ]);
  return { database, redis: redisOk, email: emailConfigured(), ai: aiConfigured(), stripe: billingConfigured() };
}

export interface QueueCounts {
  name: string;
  available: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

let queues: { name: string; queue: Queue }[] | null = null;
function adminQueues() {
  if (!queues) {
    const connection = () => new Redis(env().REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 1500, lazyConnect: false });
    // One shared connection is fine for Queue (non-blocking) clients.
    const conn = connection();
    queues = WORKER_QUEUES.map(({ name }) => ({ name, queue: new Queue(name, { connection: conn, prefix: prefixFor(name) }) }));
    for (const q of queues) q.queue.on("error", () => undefined);
  }
  return queues;
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** BullMQ job counts per queue via Redis; `available: false` when Redis cannot be reached. */
export async function queueCounts(): Promise<QueueCounts[]> {
  return Promise.all(
    adminQueues().map(async ({ name, queue }) => {
      try {
        const c = await withTimeout(queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"), 2500);
        return { name, available: true, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0, paused: 0 };
      } catch {
        return { name, available: false, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 };
      }
    }),
  );
}

/** Recently failed BullMQ jobs (name, reason, time) — never job data, which may hold personal data. */
export async function failedJobs(limit = 20) {
  const out: { queue: string; id: string | undefined; name: string; reason: string; at: number | null }[] = [];
  for (const { name, queue } of adminQueues()) {
    try {
      const jobs = await withTimeout(queue.getFailed(0, limit - 1), 2500);
      for (const j of jobs) out.push({ queue: name, id: j.id, name: j.name, reason: (j.failedReason ?? "").slice(0, 300), at: j.finishedOn ?? j.timestamp ?? null });
    } catch {
      // Redis unavailable: reported by queueCounts.
    }
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
}

export const HEARTBEAT_STALE_MS = 3 * 60_000;

export async function workerHeartbeats() {
  const rows = await db().platformHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 20 }).catch(() => []);
  return rows.map((r) => ({ ...r, alive: Date.now() - r.lastSeenAt.getTime() < HEARTBEAT_STALE_MS }));
}

/** Recent failures across the platform: AI tasks, integration syncs, workflow runs and webhook deliveries. */
export async function recentErrors(take = 15) {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [tasks, syncs, runs, deliveries] = await Promise.all([
    db().agentTask.findMany({ where: { status: "FAILED", completedAt: { gte: since } }, orderBy: { completedAt: "desc" }, take, select: { id: true, organizationId: true, title: true, errorCode: true, errorMessage: true, completedAt: true } }),
    db().integrationSyncRun.findMany({ where: { status: "FAILED", startedAt: { gte: since } }, orderBy: { startedAt: "desc" }, take, select: { id: true, organizationId: true, provider: true, kind: true, startedAt: true, errorCount: true } }),
    db().workflowRun.findMany({ where: { status: "FAILED", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take, select: { id: true, organizationId: true, error: true, finishedAt: true, createdAt: true, workflow: { select: { name: true } } } }),
    db().integrationWebhookDelivery.findMany({ where: { status: "FAILED", updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take, select: { id: true, organizationId: true, eventType: true, lastError: true, lastStatusCode: true, updatedAt: true } }),
  ]);
  return { tasks, syncs, runs, deliveries };
}

export async function systemOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, MONITOR_PERMS);
  const [health, queues, heartbeats, errors, failed] = await Promise.all([platformHealth(), queueCounts(), workerHeartbeats(), recentErrors(), failedJobs()]);
  return { health, queues, heartbeats, errors, failed };
}
