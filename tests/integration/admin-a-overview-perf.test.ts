import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { clearAggregateCache, commandCenter, computeCommandCenter, COMMAND_CENTER_TTL_MS } from "@/server/modules/admin/overview";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { grant, makeUser, resetDb } from "../helpers";

/**
 * Command Center performance (stream A): the KPI computation is a bounded number of queries (no N+1, independent of
 * data volume), runs in parallel within a time budget, and repeat views inside the TTL are served from the cache
 * without touching the KPI tables again.
 */
const globalForDb = globalThis as unknown as { realyDb?: ReturnType<typeof db> };
let queries = 0;
let original: ReturnType<typeof db> | undefined;

beforeAll(async () => {
  await resetDb();
  original = db();
  // Count every model operation and raw query issued through the shared client.
  globalForDb.realyDb = original.$extends({
    query: {
      $allOperations({ args, query }) {
        queries++;
        return query(args);
      },
    },
  }) as unknown as ReturnType<typeof db>;
});

afterAll(() => {
  globalForDb.realyDb = original;
});

describe("command center performance", () => {
  it("computes every KPI set in a bounded number of queries and within budget", async () => {
    // Some data, so the queries are not trivially empty.
    for (let i = 0; i < 5; i++) await makeUser();
    queries = 0;
    const started = performance.now();
    const data = await computeCommandCenter("30d");
    const ms = performance.now() - started;
    const first = queries;
    expect(data.sections.map((s) => s.id)).toEqual(["users", "organizations", "revenue", "subscriptions", "ai", "system"]);
    expect(data.sections.find((s) => s.id === "users")!.kpis.find((k) => k.key === "newUsers")!.value).toBeGreaterThanOrEqual(5);
    expect(queries).toBeLessThanOrEqual(40);
    expect(ms).toBeLessThan(5000);

    // Volume-independent: ten times the users, the same number of queries.
    for (let i = 0; i < 20; i++) await makeUser();
    queries = 0;
    await computeCommandCenter("30d");
    expect(queries).toBe(first);
  });

  it("serves repeat views from the cache and filters KPI sets per role", async () => {
    clearAggregateCache();
    const root = await makeUser();
    await grant(root.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    const first = await commandCenter(root.ctx, "7d");
    expect(first.sections).toHaveLength(6);
    expect(first.status).not.toBeNull();

    queries = 0;
    const again = await commandCenter(root.ctx, "7d");
    expect(again.cache).toBe("memory");
    expect(again.computedAt).toBe(first.computedAt);
    expect(queries).toBeLessThanOrEqual(2); // permission lookups only, no KPI query
    expect(COMMAND_CENTER_TTL_MS).toBeLessThanOrEqual(60_000);

    const ai = await makeUser();
    await grant(ai.user.id, "AI_OPERATIONS_ADMIN", "PLATFORM", PLATFORM_ID);
    const view = await commandCenter(ai.ctx, "7d");
    expect(view.sections.map((s) => s.id)).toEqual(["organizations", "ai", "system"]);

    const content = await makeUser();
    await grant(content.user.id, "CONTENT_ADMIN", "PLATFORM", PLATFORM_ID);
    const none = await commandCenter(content.ctx, "7d");
    expect(none.sections).toEqual([]);
    expect(none.status).toBeNull();

    await expect(commandCenter((await makeUser()).ctx, "7d")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("compares the period with the previous one and marks missing history honestly", async () => {
    clearAggregateCache();
    const d = await computeCommandCenter("24h");
    expect(d.buckets.length).toBeGreaterThanOrEqual(24);
    const users = d.sections.find((s) => s.id === "users")!;
    const newUsers = users.kpis.find((k) => k.key === "newUsers")!;
    expect(newUsers.previous).not.toBeNull();
    expect(newUsers.series).toHaveLength(d.buckets.length);
    const total = users.kpis.find((k) => k.key === "totalUsers")!;
    expect(total.previous).toBeNull();
    expect(total.missing?.stream).toBe("D");
    // Uptime comes from stream E's probes when there are any, else it says what is missing.
    const uptime = d.sections.find((s) => s.id === "system")!.kpis.find((k) => k.key === "uptime")!;
    if (uptime.status === "not_tracked") expect(uptime).toMatchObject({ value: null, missing: { stream: "E" } });
    else {
      expect(uptime).toMatchObject({ status: "ok", format: "percent" });
      expect(uptime.value).toBeGreaterThanOrEqual(0);
      expect(uptime.value).toBeLessThanOrEqual(100);
    }
    const p95 = d.sections.find((s) => s.id === "system")!.kpis.find((k) => k.key === "latencyP95")!;
    expect(p95).toMatchObject({ status: "not_tracked", value: null, missing: { stream: "E" } });
    // Strip: stream E counts, real (zero here unless other files left rows), never "not tracked".
    expect(d.status.ops).not.toBeNull();
  });
});
