import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { PeriodicJob } from "@/server/core/module-jobs";
import { JOB_DEFAULTS, queuePrefix, SCHEDULES_QUEUE } from "@/server/core/jobs";
import { getControls, moduleForJobName } from "@/server/core/platform-controls";
import { logger } from "@/server/core/logger";
import { WORKER_ID } from "./tracking";

/**
 * Recurring work on BullMQ job schedulers: each periodic job (recurring invoices, scheduled posts, workflow and AI
 * schedules, integration syncs, maintenance...) gets one scheduler on the "schedules" queue, so every tick produces
 * exactly one job no matter how many worker replicas run. A Redis lock per job name prevents a slow run from
 * overlapping with the next tick on another replica.
 */

const log = logger.child({ component: "schedules" });

/** Create/refresh one scheduler per periodic job and remove schedulers of jobs that no longer exist. */
export async function registerSchedulers(queue: Queue, jobs: PeriodicJob[]): Promise<void> {
  const wanted = new Set(jobs.map((j) => j.name));
  for (const j of jobs) {
    await queue.upsertJobScheduler(j.name, { every: j.everyMs }, { name: j.name, data: {}, opts: { ...JOB_DEFAULTS[SCHEDULES_QUEUE] } });
  }
  const existing = await queue.getJobSchedulers(0, 500);
  for (const s of existing) {
    const id = s.key ?? s.name;
    if (id && !wanted.has(id)) {
      await queue.removeJobScheduler(id);
      log.info({ scheduler: id }, "removed stale job scheduler");
    }
  }
  log.info({ schedulers: jobs.length }, "job schedulers registered");
}

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/** Processor of the schedules queue (also runs requeued scheduler jobs, which carry the same name). */
export function scheduleProcessor(jobs: PeriodicJob[], redis: Redis) {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  return async (job: Job): Promise<number> => {
    const def = byName.get(job.name);
    if (!def) {
      log.warn({ job: job.name }, "no periodic job with this name; skipped");
      return 0;
    }
    // Platform controls: pause all background jobs, automations off, and modules disabled platform-wide.
    const controls = await getControls();
    if (controls.backgroundJobsPaused) return 0;
    if (!controls.automationsEnabled && def.name.startsWith("automation.")) return 0;
    const mod = moduleForJobName(def.name);
    if (mod && controls.disabledModules.includes(mod)) return 0;

    const lockKey = `${queuePrefix()}:schedule-lock:${def.name}`;
    const token = `${WORKER_ID}:${job.id}`;
    const ttl = Math.max(def.everyMs * 5, 10 * 60_000);
    const acquired = await redis.set(lockKey, token, "PX", ttl, "NX");
    if (!acquired) return 0; // previous run still in progress
    try {
      const n = await def.run();
      return typeof n === "number" ? n : 0;
    } finally {
      await redis.eval(RELEASE, 1, lockKey, token).catch(() => undefined);
    }
  };
}
