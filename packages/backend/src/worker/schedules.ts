import { createHash } from "node:crypto";
import type { Job, Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { PeriodicJob } from "@/server/core/module-jobs";
import { JOB_DEFAULTS, queuePrefix, SCHEDULES_QUEUE } from "@/server/core/jobs";
import { getControls, moduleForJobName } from "@/server/core/platform-controls";
import { logger } from "@/server/core/logger";
import { withSpan } from "@/server/core/telemetry";
import { errorMessage, tracked, WORKER_ID, type DeadLetterSink } from "./tracking";

/**
 * Recurring work (recurring invoices, scheduled posts, workflow and AI schedules, integration syncs, maintenance...).
 *
 * Every replica with the "schedules" role runs a {@link PeriodicRunner}: every WORKER_SCHEDULE_TICK_MS it makes ONE
 * Redis script call against a single hash (`<prefix>:schedule-state`) that atomically
 *   - records the runs this replica finished since the last tick (that slot of the job is done),
 *   - renews the leases of the runs it still has in progress,
 *   - claims the periodic jobs whose current slot (floor((now − phase) / everyMs)) is not done and that no live lease
 *     holds, up to this replica's free capacity.
 * The claimed jobs then run in-process. So every slot of every job runs once across all replicas, a slow run never
 * overlaps with the next one (its lease is renewed until it finishes), and a run lost with its replica (crash, kill)
 * is claimed again by another replica once its lease lapses (at-least-once, as before: jobs are idempotent).
 *
 * This replaces one BullMQ job scheduler per job: each scheduler tick was a full BullMQ job (~55 Redis commands
 * counting the ones inside BullMQ's Lua scripts), ~30 per minute with nobody using the platform. Now an idle tick costs
 * 2–3 commands per replica. Failed runs are retried in-process with the schedules queue's attempts and backoff,
 * persisted in worker_job_runs and dead-lettered as before; a dead-lettered run requeued by an administrator runs on
 * the "schedules" BullMQ queue through {@link scheduleProcessor}.
 */

const log = logger.child({ component: "schedules" });

/** Remove the BullMQ job schedulers earlier versions registered (one per periodic job): the runner replaces them. */
export async function removeLegacySchedulers(queue: Queue): Promise<number> {
  let removed = 0;
  for (;;) {
    const existing = await queue.getJobSchedulers(0, 199);
    if (!existing.length) break;
    let progress = false;
    for (const s of existing) {
      const id = s.key ?? s.name;
      if (id && (await queue.removeJobScheduler(id))) {
        removed++;
        progress = true;
      }
    }
    if (existing.length < 200 || !progress) break;
  }
  if (removed) log.info({ removed }, "removed legacy BullMQ job schedulers (recurring jobs now use the periodic runner)");
  return removed;
}

/** Platform controls: pause all background jobs, automations off, and modules disabled platform-wide. */
async function skippedByControls(def: PeriodicJob): Promise<boolean> {
  const controls = await getControls();
  if (controls.backgroundJobsPaused) return true;
  if (!controls.automationsEnabled && def.name.startsWith("automation.")) return true;
  const mod = moduleForJobName(def.name);
  return !!mod && controls.disabledModules.includes(mod);
}

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/**
 * Processor of the "schedules" BullMQ queue: runs jobs put there by hand (an administrator requeuing a dead-lettered
 * run) and any tick a legacy job scheduler left behind. Redis lock per job name against overlapping manual runs.
 */
export function scheduleProcessor(jobs: PeriodicJob[], redis: Redis) {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  return async (job: Job): Promise<number> => {
    const def = byName.get(job.name);
    if (!def) {
      log.warn({ job: job.name }, "no periodic job with this name; skipped");
      return 0;
    }
    if (await skippedByControls(def)) return 0;

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

// ───────────────────────────── Periodic runner ─────────────────────────────

/** Redis hash with each job's last finished slot (`<name>|d`) and current lease (`<name>|r` = "owner,untilMs,slot"). */
export const scheduleStateKey = () => `${queuePrefix()}:schedule-state`;

/**
 * KEYS[1] state hash. ARGV: now, owner, leaseMs, maxClaims, then
 *   nJobs, nJobs × (name, everyMs, phaseMs)   candidates, most frequent first
 *   nDone, nDone × (name, slot)               finished runs: slot done, lease dropped
 *   nRelease, nRelease × name                 claimed but not finished (shutdown, error): lease dropped, slot stays due
 *   nRenew, nRenew × name                     still running here: lease extended
 * Returns the claimed jobs as a flat list name, slot, name, slot...
 * Inside: one HGETALL and at most one HSET. Numbers are formatted with %.0f (Lua's tostring would print 1.7e+12).
 */
export const CLAIM_SCRIPT = `
local now = tonumber(ARGV[1])
local owner = ARGV[2]
local lease = tonumber(ARGV[3])
local maxClaims = tonumber(ARGV[4])
local raw = redis.call('HGETALL', KEYS[1])
local st = {}
for i = 1, #raw, 2 do st[raw[i]] = raw[i + 1] end
local upd = {}
local function get(f) local v = upd[f]; if v == nil then v = st[f] end; return v end
local function lease_of(name)
  local v = get(name .. '|r')
  if not v or v == '' then return nil end
  local o, u, s = string.match(v, '^(.*),(%d+),(%-?%d+)$')
  if not o then return nil end
  return o, tonumber(u), s
end
local i = 5
local nJobs = tonumber(ARGV[i]); i = i + 1
local jobs = {}
for j = 1, nJobs do jobs[j] = { ARGV[i], tonumber(ARGV[i + 1]), tonumber(ARGV[i + 2]) }; i = i + 3 end
local nDone = tonumber(ARGV[i]); i = i + 1
for j = 1, nDone do
  local name, slot = ARGV[i], ARGV[i + 1]; i = i + 2
  if lease_of(name) == owner then upd[name .. '|r'] = '' end
  if tonumber(slot) > tonumber(get(name .. '|d') or '-1') then upd[name .. '|d'] = slot end
end
local nRelease = tonumber(ARGV[i]); i = i + 1
for j = 1, nRelease do
  local name = ARGV[i]; i = i + 1
  if lease_of(name) == owner then upd[name .. '|r'] = '' end
end
local nRenew = tonumber(ARGV[i]); i = i + 1
for j = 1, nRenew do
  local name = ARGV[i]; i = i + 1
  local o, u, s = lease_of(name)
  if o == owner then upd[name .. '|r'] = owner .. ',' .. string.format('%.0f', now + lease) .. ',' .. s end
end
local claimed = {}
for j = 1, nJobs do
  if #claimed / 2 >= maxClaims then break end
  local name, every, phase = jobs[j][1], jobs[j][2], jobs[j][3]
  local slot = math.floor((now - phase) / every)
  local o, u = lease_of(name)
  if not (o and u > now) and tonumber(get(name .. '|d') or '-1') < slot then
    local s = string.format('%.0f', slot)
    upd[name .. '|r'] = owner .. ',' .. string.format('%.0f', now + lease) .. ',' .. s
    claimed[#claimed + 1] = name
    claimed[#claimed + 1] = s
  end
end
local flat = {}
for k, v in pairs(upd) do flat[#flat + 1] = k; flat[#flat + 1] = v end
if #flat > 0 then redis.call('HSET', KEYS[1], unpack(flat)) end
return claimed
`;

const CLAIM_SHA = createHash("sha1").update(CLAIM_SCRIPT).digest("hex");

/** Run the claim script by its SHA (the 4 KB body is sent only when Redis does not know it yet). */
async function claim(redis: Pick<Redis, "eval" | "evalsha">, args: string[]): Promise<string[]> {
  try {
    return (await redis.evalsha(CLAIM_SHA, 1, scheduleStateKey(), ...args)) as string[];
  } catch (err) {
    if (!errorMessage(err).includes("NOSCRIPT")) throw err;
    return (await redis.eval(CLAIM_SCRIPT, 1, scheduleStateKey(), ...args)) as string[];
  }
}

/** Deterministic per-job phase in [0, everyMs): hourly and daily jobs do not all start on the same second. */
export function phaseOf(name: string, everyMs: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return h % everyMs;
}

export interface PeriodicRunnerOptions {
  redis: Pick<Redis, "eval" | "evalsha">;
  jobs: PeriodicJob[];
  tickMs: number;
  /** Runs executing at once on this replica. */
  concurrency: number;
  deadLetter: DeadLetterSink | null;
  /** Lease of a claimed run, renewed every tick while it runs (default max(4 ticks, 2 min)). */
  leaseMs?: number;
  owner?: string;
  /** First retry delay (default: the schedules queue's backoff, doubled per attempt). */
  backoffMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Claims due periodic jobs on a timer and runs them in-process (see the file comment). */
export class PeriodicRunner {
  private readonly byName: Map<string, PeriodicJob>;
  private readonly candidates: string[];
  private readonly leaseMs: number;
  private readonly owner: string;
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly abort = new AbortController();
  /** Claimed by this replica and not finished (running or waiting for a free slot): name → slot. */
  private readonly mine = new Map<string, string>();
  private readonly waiting: { name: string; slot: string }[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private running = 0;
  /** Reported to Redis at the next tick. */
  private done: [string, string][] = [];
  private release: string[] = [];
  private loop: Promise<void> | null = null;
  private lastBatchFull = false;

  constructor(private readonly o: PeriodicRunnerOptions) {
    this.byName = new Map(o.jobs.map((j) => [j.name, j]));
    // Most frequent first, so a replica short of capacity claims those before the hourly ones.
    this.candidates = [...o.jobs].sort((a, b) => a.everyMs - b.everyMs).flatMap((j) => [j.name, String(j.everyMs), String(phaseOf(j.name, j.everyMs))]);
    this.leaseMs = o.leaseMs ?? Math.max(4 * o.tickMs, 120_000);
    this.owner = o.owner ?? WORKER_ID;
    this.attempts = JOB_DEFAULTS[SCHEDULES_QUEUE].attempts;
    this.backoffMs = o.backoffMs ?? JOB_DEFAULTS[SCHEDULES_QUEUE].backoff.delay;
  }

  start(): void {
    this.loop ??= (async () => {
      while (!this.abort.signal.aborted) {
        await this.tick();
        // A full batch means more jobs are due (first start, after an outage): claim again soon, not a tick later.
        await sleep(this.lastBatchFull ? Math.min(1_000, this.o.tickMs) : this.o.tickMs, this.abort.signal);
      }
    })();
  }

  /** One claim round (exposed for tests). Never throws: after a Redis error the reports are re-sent next tick. */
  async tick(now = Date.now()): Promise<string[]> {
    const done = this.done;
    const release = this.release;
    const free = this.abort.signal.aborted ? 0 : Math.max(0, this.o.concurrency * 2 - this.mine.size);
    const renew = [...this.mine.keys()];
    const args = [now, this.owner, this.leaseMs, free, this.o.jobs.length, ...this.candidates, done.length, ...done.flat(), release.length, ...release, renew.length, ...renew].map(String);
    let claimed: string[];
    try {
      claimed = await claim(this.o.redis, args);
    } catch (err) {
      log.warn({ err: errorMessage(err) }, "periodic job claim failed; retrying next tick");
      return [];
    }
    this.done = this.done.slice(done.length);
    this.release = this.release.slice(release.length);
    this.lastBatchFull = free > 0 && claimed.length / 2 >= free;
    const names: string[] = [];
    for (let i = 0; i + 1 < claimed.length; i += 2) {
      const name = claimed[i]!;
      const slot = claimed[i + 1]!;
      this.mine.set(name, slot);
      this.waiting.push({ name, slot });
      names.push(name);
    }
    this.pump();
    return names;
  }

  /** Resolves when every claimed run has finished (tests). */
  async settled(): Promise<void> {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }

  private pump() {
    while (this.running < this.o.concurrency && this.waiting.length && !this.abort.signal.aborted) {
      const { name, slot } = this.waiting.shift()!;
      this.running++;
      const p: Promise<void> = this.execute(name, slot).finally(() => {
        this.running--;
        this.inFlight.delete(p);
        this.pump();
      });
      this.inFlight.add(p);
    }
  }

  /** Run one claimed slot with retries. Resolves "done" (slot consumed) or "release" (another tick should retry it). */
  private async attemptAll(def: PeriodicJob, slot: string): Promise<"done" | "release"> {
    if (await skippedByControls(def)) return "done";
    const id = `${def.name}_${slot}`;
    const run = tracked({ queue: SCHEDULES_QUEUE, persist: "work_or_failure", deadLetter: this.o.deadLetter }, () => withSpan("worker.periodic", { job: def.name }, () => def.run()));
    for (let attempt = 0; ; attempt++) {
      // worker_job_runs and the dead-letter copy read only these fields of a BullMQ job.
      const job = { id, name: def.name, data: {}, opts: { attempts: this.attempts }, attemptsMade: attempt } as unknown as Job;
      try {
        await run(job);
        return "done";
      } catch (err) {
        log.error({ job: def.name, attempt: attempt + 1, err: errorMessage(err) }, "periodic job failed");
        if (attempt + 1 >= this.attempts) return "done"; // final failure, dead-lettered by tracked(): slot consumed
        await sleep(this.backoffMs * 2 ** attempt, this.abort.signal);
        if (this.abort.signal.aborted) return "release"; // shutting down: another replica retries the slot
      }
    }
  }

  private async execute(name: string, slot: string): Promise<void> {
    let outcome: "done" | "release" = "release";
    try {
      const def = this.byName.get(name);
      outcome = def ? await this.attemptAll(def, slot) : "done";
    } catch (err) {
      // e.g. the platform controls could not be read: try the slot again at a later tick.
      log.error({ job: name, err: errorMessage(err) }, "periodic job could not start");
    } finally {
      this.mine.delete(name);
      if (outcome === "done") this.done.push([name, slot]);
      else this.release.push(name);
    }
  }

  /** Stop claiming, wait (bounded) for running jobs, then report finished runs and hand back unstarted claims. */
  async stop(timeoutMs: number): Promise<void> {
    this.abort.abort();
    await this.loop;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all([...this.inFlight]), new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
    for (const w of this.waiting.splice(0)) {
      this.mine.delete(w.name);
      this.release.push(w.name);
    }
    // Runs still going after the timeout keep their lease, which lapses: another replica re-runs that slot.
    if (!this.done.length && !this.release.length) return;
    const args = [Date.now(), this.owner, this.leaseMs, 0, 0, this.done.length, ...this.done.flat(), this.release.length, ...this.release, 0].map(String);
    await claim(this.o.redis, args).catch((err: unknown) => log.warn({ err: errorMessage(err) }, "periodic job state flush failed"));
    this.done = [];
    this.release = [];
  }
}
