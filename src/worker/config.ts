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
    heartbeatMs: 30_000,
    /** Lock duration of AI task jobs (renewed while running). */
    agentLockMs: int("WORKER_AI_LOCK_MS", 60_000, 10_000, 600_000),
  };
}

export type WorkerConfig = ReturnType<typeof workerConfig>;
