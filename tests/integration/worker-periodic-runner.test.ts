import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { redis } from "@/server/core/rate-limit";
import type { PeriodicJob } from "@/server/core/module-jobs";
import { PeriodicRunner, phaseOf, scheduleStateKey } from "@/worker/schedules";

/**
 * Recurring jobs run in-process, claimed per slot through one Redis hash (src/worker/schedules.ts), instead of one
 * BullMQ job scheduler per job (whose ticks cost ~55 Redis commands each). Every slot runs once across replicas, a
 * running job is never claimed twice, a lost run is re-claimed after its lease, and an idle tick is one script call.
 * Requires the test Redis (REDIS_URL).
 */

const r = redis();
const MIN = 60_000;
const counter = () => {
  const runs: string[] = [];
  const job = (name: string, everyMs: number, run?: () => Promise<number | void>): PeriodicJob => ({
    name,
    everyMs,
    run: async () => {
      runs.push(name);
      return run ? run() : 0;
    },
  });
  return { runs, job };
};
/** A time inside slot `n` of a job (its phase taken into account). */
const at = (name: string, everyMs: number, n: number) => phaseOf(name, everyMs) + n * everyMs + 1_000;

beforeEach(async () => {
  await r.del(scheduleStateKey());
});

afterAll(async () => {
  await r.del(scheduleStateKey());
});

describe("periodic runner", () => {
  it("runs each slot once across replicas and again in the next slot", async () => {
    const { runs, job } = counter();
    const jobs = [job("test.a", MIN), job("test.b", MIN)];
    const a = new PeriodicRunner({ redis: r, jobs, tickMs: 15_000, concurrency: 4, deadLetter: null, owner: "replica-a" });
    const b = new PeriodicRunner({ redis: r, jobs, tickMs: 15_000, concurrency: 4, deadLetter: null, owner: "replica-b" });
    const t = at("test.a", MIN, 1000);
    const claimedA = await a.tick(t);
    const claimedB = await b.tick(t);
    expect([...claimedA, ...claimedB].sort()).toEqual(["test.a", "test.b"]);
    await a.settled();
    await b.settled();
    // Same slot: reports the finished runs, claims nothing.
    expect(await a.tick(t + 1)).toEqual([]);
    expect(await b.tick(t + 2)).toEqual([]);
    // Next slot: due again, each job once.
    const next = [...(await a.tick(t + MIN)), ...(await b.tick(t + MIN))];
    expect(next.sort()).toEqual(["test.a", "test.b"]);
    await a.settled();
    await b.settled();
    expect(runs.sort()).toEqual(["test.a", "test.a", "test.b", "test.b"]);
  });

  it("never claims a job another replica is still running; re-claims it once that lease lapses", async () => {
    const pending: (() => void)[] = [];
    let released = false;
    const slow: PeriodicJob = { name: "test.slow", everyMs: MIN, run: () => new Promise<void>((res) => (released ? res() : pending.push(res))) };
    const a = new PeriodicRunner({ redis: r, jobs: [slow], tickMs: 15_000, concurrency: 1, deadLetter: null, owner: "replica-a", leaseMs: 2 * MIN });
    const b = new PeriodicRunner({ redis: r, jobs: [slow], tickMs: 15_000, concurrency: 1, deadLetter: null, owner: "replica-b", leaseMs: 2 * MIN });
    const t = at("test.slow", MIN, 2000);
    expect(await a.tick(t)).toEqual(["test.slow"]);
    // Next slot while A still runs (A renews its lease each tick): B must not start an overlapping run.
    await a.tick(t + MIN);
    expect(await b.tick(t + MIN + 1)).toEqual([]);
    // A dies without reporting: once the lease (renewed at t + MIN) lapses, B takes the slot over.
    expect(await b.tick(t + 3 * MIN + 1_000)).toEqual(["test.slow"]);
    released = true;
    for (const res of pending) res();
    await a.settled();
    await b.settled();
  });

  it("retries a failing run with backoff and records the slot as done", async () => {
    let calls = 0;
    const flaky: PeriodicJob = {
      name: "test.flaky",
      everyMs: MIN,
      run: async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return 1;
      },
    };
    const a = new PeriodicRunner({ redis: r, jobs: [flaky], tickMs: 15_000, concurrency: 1, deadLetter: null, owner: "replica-a", backoffMs: 10 });
    const t = at("test.flaky", MIN, 3000);
    expect(await a.tick(t)).toEqual(["test.flaky"]);
    await a.settled();
    expect(calls).toBe(3);
    expect(await a.tick(t + 1)).toEqual([]);
    const state = await r.hgetall(scheduleStateKey());
    expect(state["test.flaky|r"]).toBe("");
    expect(Number(state["test.flaky|d"])).toBe(Math.floor((t - phaseOf("test.flaky", MIN)) / MIN));
  });

  it("hands unstarted claims back on shutdown", async () => {
    let release!: () => void;
    const jobs: PeriodicJob[] = [
      { name: "test.busy", everyMs: MIN, run: () => new Promise<void>((res) => (release = res)) },
      { name: "test.queued", everyMs: 2 * MIN, run: async () => undefined },
    ];
    const a = new PeriodicRunner({ redis: r, jobs, tickMs: 15_000, concurrency: 1, deadLetter: null, owner: "replica-a" });
    const t = 10_000_000 * MIN;
    expect((await a.tick(t)).sort()).toEqual(["test.busy", "test.queued"]);
    const stopping = a.stop(50); // test.busy keeps running past the timeout; test.queued never started
    await stopping;
    const b = new PeriodicRunner({ redis: r, jobs, tickMs: 15_000, concurrency: 1, deadLetter: null, owner: "replica-b" });
    expect(await b.tick(t + 1)).toEqual(["test.queued"]);
    release();
    await b.settled();
  });
});
