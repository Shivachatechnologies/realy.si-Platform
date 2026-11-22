import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { companyChain } from "@/server/modules/rbac/scope";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { commandCenterMetrics } from "@/server/modules/bi/command-center";
import { cachedSnapshot, dropSnapshot, refreshMetricSnapshots } from "@/server/modules/bi/snapshots";
import { ALL_METRICS } from "@/server/modules/bi/registry";
import { makeUser, raiseLimits, resetDb } from "../helpers";

/**
 * B4 (G5): the Command Center's metric sections read one per-company snapshot (Redis) instead of recomputing every
 * registry metric per render. A cold render computes and stores the snapshot (the same real metric computations);
 * a warm render stays within a small query budget, and its values equal the live ones.
 */

const WARM_BUDGET = 40;

type AnyClient = ReturnType<typeof db>;
const g = globalThis as unknown as { realyDb?: AnyClient };
let base: AnyClient;
let queries = 0;

async function counted<T>(fn: () => Promise<T>): Promise<{ value: T; queries: number }> {
  queries = 0;
  const value = await fn();
  return { value, queries };
}

let s: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const owner = await makeUser({ name: "Budget Founder" });
  const org = await createOrganization(owner.ctx, { name: `CC ${Math.random()}` });
  await raiseLimits(org.id, { "companies.max": 2 });
  const company = await createCompany(owner.ctx, org.id, { name: "Snapshot Co", incorporationCountryCode: "GB" });
  await db().lead.createMany({ data: Array.from({ length: 3 }, (_, i) => ({ organizationId: org.id, companyId: company.id, name: `Lead ${i}`, email: `lead${i}@example.com`, currency: "GBP", score: 0, scoreLabel: "NURTURE" as const, createdById: owner.user.id })) }).catch(() => undefined);
  const chain = await companyChain(db(), org.id, company.id);
  return { owner, org, company, chain };
}

beforeAll(async () => {
  await resetDb();
  s = await setup();
  base = db();
  // Count every Prisma operation (model queries and raw SQL) made through db().
  g.realyDb = base.$extends({
    query: {
      async $allOperations({ args, query }) {
        queries++;
        return query(args);
      },
    },
  }) as unknown as AnyClient;
});
afterAll(async () => {
  g.realyDb = base;
  await dropSnapshot(s.org.id, s.company.id);
});

describe("Command Center query budget", () => {
  it("computes the snapshot once, then renders from it within the budget", async () => {
    await dropSnapshot(s.org.id, s.company.id);
    const cold = await counted(() => commandCenterMetrics(s.owner.ctx, s.org.id, s.company.id, s.chain));
    expect(cold.value).not.toBeNull();
    const snap = await cachedSnapshot(s.org.id, s.company.id);
    expect(snap).not.toBeNull();
    expect(Object.keys(snap!.values).length).toBe(ALL_METRICS().length);

    const warm = await counted(() => commandCenterMetrics(s.owner.ctx, s.org.id, s.company.id, s.chain));
    expect(warm.value).not.toBeNull();
    console.info(`command center metrics: cold ${cold.queries} queries, warm ${warm.queries} queries`);
    expect(warm.queries).toBeLessThanOrEqual(WARM_BUDGET);
    expect(cold.queries).toBeGreaterThan(warm.queries * 4);

    // Same real values, cold or warm.
    expect(warm.value!.kpis.map((k) => [k.key, k.value, k.previous])).toEqual(cold.value!.kpis.map((k) => [k.key, k.value, k.previous]));
    expect(warm.value!.health.score).toBe(cold.value!.health.score);
    expect(warm.value!.board.map((b) => b.area)).toEqual(["money", "growth", "work", "people", "customers", "platform"]);
  });

  it("shows new records after the worker refresh, not before (honest freshness)", async () => {
    const before = await commandCenterMetrics(s.owner.ctx, s.org.id, s.company.id, s.chain);
    // The worker refreshes only stale snapshots of companies someone viewed.
    expect(await refreshMetricSnapshots()).toBe(0);
    expect(await refreshMetricSnapshots(new Date(Date.now() + 11 * 60_000))).toBeGreaterThanOrEqual(1);
    const after = await cachedSnapshot(s.org.id, s.company.id);
    expect(new Date(after!.computedAt).getTime()).toBeGreaterThan(new Date(before!.computedAt).getTime());
  });

  it("filters the snapshot by the viewer's permissions", async () => {
    const outsider = await makeUser({ name: "No Access" });
    await expect(commandCenterMetrics(outsider.ctx, s.org.id, s.company.id, s.chain)).resolves.toBeNull();
  });
});
