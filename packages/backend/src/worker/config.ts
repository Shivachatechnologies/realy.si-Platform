/**
 * Worker service configuration from the environment (docs/deployment.md "Worker service"). Every value has a safe
 * default, so a worker started with only DATABASE_URL, REDIS_URL and ENCRYPTION_KEY runs everything.
 */

const int = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export const WORKER_ROLES = ["relay", "agents", "events", "modules", "schedules", "webhooks", "email"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

/**
 * Which parts this process runs. Default: all. Set e.g. WORKER_ROLES=agents to scale AI execution separately from
 * the rest (every role must run in at least one replica).
 */
function roles(): Set<WorkerRole> {
  const raw = process.env.WORKER_ROLES?.trim();
  if (!raw || raw === "all") return new Set(WORKER_ROLES);
  const picked = raw
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is WorkerRole => (WORKER_ROLES as readonly string[]).includes(r));
  return new Set(picked.length ? picked : WORKER_ROLES);
}

export function workerConfig() {
  return {
    roles: roles(),
    concurrency: {
      agentTasks: int("WORKER_AI_CONCURRENCY", 2, 1, 50),
      events: int("WORKER_EVENTS_CONCURRENCY", 4, 1, 50),
      moduleJobs: int("WORKER_MODULE_CONCURRENCY", 4, 1, 50),
      schedules: int("WORKER_SCHEDULE_CONCURRENCY", 4, 1, 50),
      webhooks: int("WORKER_WEBHOOK_CONCURRENCY", 8, 1, 100),
      authEmail: int("WORKER_EMAIL_CONCURRENCY", 5, 1, 50),
    },
    /** How long a graceful shutdown waits for running jobs before closing forcefully (keep below the platform's kill timeout). */
    shutdownTimeoutMs: int("WORKER_SHUTDOWN_TIMEOUT_MS", 25_000, 1_000, 300_000),
    /**
     * Heartbeat (Postgres row + Redis key) interval. A worker counts as alive for 3 minutes after its last beat
     * (src/server/core/job-admin.ts WORKER_STALE_MS), so keep this well below that.
     */
    heartbeatMs: int("WORKER_HEARTBEAT_MS", 60_000, 10_000, 90_000),
    /** Lock duration of AI task jobs (renewed while running). */
    agentLockMs: int("WORKER_AI_LOCK_MS", 60_000, 10_000, 600_000),
    // ── Redis command budget (docs/deployment.md "Redis command budget"). Managed Redis such as Upstash bills every
    // command, including the ones BullMQ's Lua scripts run, so idle polling is kept to a minimum. ──
    /**
     * Seconds an idle BullMQ worker blocks (BZPOPMIN) on an empty queue before polling again. A new job wakes it at
     * once, so this does not delay work; it only sets the idle poll rate (BullMQ default 5). A queue holding delayed
     * jobs still wakes at least every 10 s (BullMQ's cap).
     */
    drainDelayS: int("WORKER_DRAIN_DELAY_S", 60, 1, 300),
    /** How often each worker checks its queue for stalled jobs (lock expired: crashed or killed worker). BullMQ default 30 s. */
    stalledIntervalMs: int("WORKER_STALLED_INTERVAL_MS", 120_000, 5_000, 600_000),
    /** Times a job may stall (be recovered after its worker died) before it fails. BullMQ default 1. */
    maxStalledCount: int("WORKER_MAX_STALLED_COUNT", 1, 1, 10),
    /**
     * Recurring jobs: how often each replica checks which periodic jobs are due (one Redis script call per check). Also
     * the finest schedule resolution: a job every 15 s starts at most this late. Default 15 s (the shortest interval).
     */
    scheduleTickMs: int("WORKER_SCHEDULE_TICK_MS", 15_000, 1_000, 300_000),
    /** Outbox relay: an idle relay backs off from 500 ms up to this between database polls (no Redis involved). */
    relayIdleMaxMs: int("WORKER_RELAY_IDLE_MAX_MS", 2_000, 500, 30_000),
  };
}

export type WorkerConfig = ReturnType<typeof workerConfig>;
